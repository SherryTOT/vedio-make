/**
 * Post-render self-review — the "看真实产物" gate, automated.
 *
 * After final.mp4 is stitched, actually LOOK at it instead of trusting that the
 * render "should be fine": ffprobe the container, sample 4 frames and check they
 * aren't black/flat, and measure audio levels for silence/clipping. Writes
 * output/qa-report.json (+ output/qa/frame-*.jpg) and returns a pass/warn/fail
 * verdict. Never throws — a review failure must not break a good render.
 *
 * Clean-room + MIT, inspired by OpenMontage's visual_qa / frame_sampler /
 * audio_probe (AGPL) — reimplemented for Vedio Make's shape.
 */
import fs from "node:fs";
import path from "node:path";
import { runCapture } from "./proc.ts";
import { loadPromise, diffPromise } from "./promise.ts";
import { METHOD_RENDERERS } from "./methods/registry.ts";
import { lintSource } from "./methods/lint.ts";
import { resolveSceneDesign } from "./methods/designs.ts";
import type { Storyboard } from "./types.ts";

export interface QaFrame { tSec: number; path: string; yavg: number | null; black: boolean; flat: boolean }
export interface QaFinding { level: "error" | "warn" | "info"; msg: string }
/** One row of the DIRECTION §四 渲染后审美验收 checklist. `manual` = can't be auto-judged. */
export interface ChecklistItem { n: number; label: string; status: "pass" | "warn" | "fail" | "manual"; detail: string }
export interface QaReport {
  status: "pass" | "warn" | "fail";
  generatedAt: string;
  final: string;
  video: {
    exists: boolean;
    durationSec: number | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    codec: string | null;
    hasAudio: boolean;
    sizeBytes: number;
  };
  expected: { durationSec: number; width: number; height: number };
  frames: QaFrame[];
  audio: { expected: boolean; present: boolean; meanDb: number | null; maxDb: number | null; silent: boolean; clipping: boolean };
  findings: QaFinding[];
  /** DIRECTION §四 10 条审美验收自查(auto where possible, else manual). */
  checklist: ChecklistItem[];
}

const FF_TIMEOUT = 60_000;
const num = (s: string | undefined): number | null => {
  if (s == null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

async function probe(final: string): Promise<any | null> {
  const r = await runCapture("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", final], { timeoutMs: FF_TIMEOUT });
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

/** Sample one frame: save a jpg AND read its luma stats in a single ffmpeg pass. */
async function sampleFrame(final: string, tSec: number, outJpg: string): Promise<{ yavg: number | null; ymin: number | null; ymax: number | null }> {
  const r = await runCapture(
    "ffmpeg",
    ["-y", "-ss", tSec.toFixed(2), "-i", final, "-frames:v", "1", "-vf", "signalstats,metadata=print:file=-", "-q:v", "3", outJpg],
    { timeoutMs: FF_TIMEOUT },
  );
  // metadata=print writes "lavfi.signalstats.YAVG=NN" to stdout.
  const grab = (key: string) => num(new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.]+)`).exec(r.stdout)?.[1]);
  return { yavg: grab("YAVG"), ymin: grab("YMIN"), ymax: grab("YMAX") };
}

/** volumedetect reports mean/max volume on STDERR. */
async function audioLevels(final: string): Promise<{ meanDb: number | null; maxDb: number | null }> {
  const r = await runCapture("ffmpeg", ["-i", final, "-af", "volumedetect", "-vn", "-f", "null", "-"], { timeoutMs: FF_TIMEOUT });
  const mean = num(/mean_volume:\s*(-?[0-9.]+) dB/.exec(r.stderr)?.[1]);
  const max = num(/max_volume:\s*(-?[0-9.]+) dB/.exec(r.stderr)?.[1]);
  return { meanDb: mean, maxDb: max };
}

export async function reviewFinal(
  sb: Storyboard,
  outputDir: string,
  projectRoot: string,
  expectedDurationSec?: number,
): Promise<QaReport> {
  const final = path.join(outputDir, "final.mp4");
  const expected = {
    durationSec: expectedDurationSec ?? sb.scenes.at(-1)?.endSec ?? 0,
    width: sb.project.width,
    height: sb.project.height,
  };
  const findings: QaFinding[] = [];
  const report: QaReport = {
    status: "pass",
    generatedAt: new Date().toISOString(),
    final: path.relative(projectRoot, final),
    video: { exists: false, durationSec: null, width: null, height: null, fps: null, codec: null, hasAudio: false, sizeBytes: 0 },
    expected,
    frames: [],
    audio: { expected: false, present: false, meanDb: null, maxDb: null, silent: false, clipping: false },
    findings,
    checklist: [],
  };

  if (!fs.existsSync(final)) {
    findings.push({ level: "error", msg: "final.mp4 不存在 — 渲染/拼接没产出成片" });
    report.status = "fail";
    writeReport(outputDir, report);
    return report;
  }
  report.video.exists = true;
  report.video.sizeBytes = (() => { try { return fs.statSync(final).size; } catch { return 0; } })();
  if (report.video.sizeBytes < 1024) findings.push({ level: "error", msg: `final.mp4 只有 ${report.video.sizeBytes}B — 几乎肯定是坏文件` });

  // ─ Container / streams ─
  const info = await probe(final);
  if (!info) {
    findings.push({ level: "error", msg: "ffprobe 读不了 final.mp4(容器损坏或 ffprobe 缺失)" });
    report.status = "fail";
    writeReport(outputDir, report);
    return report;
  }
  const vstream = (info.streams ?? []).find((s: any) => s.codec_type === "video");
  const astream = (info.streams ?? []).find((s: any) => s.codec_type === "audio");
  report.video.durationSec = num(info.format?.duration);
  report.video.width = vstream?.width ?? null;
  report.video.height = vstream?.height ?? null;
  report.video.codec = vstream?.codec_name ?? null;
  report.video.hasAudio = Boolean(astream);
  if (vstream?.avg_frame_rate && vstream.avg_frame_rate !== "0/0") {
    const [nn, dd] = String(vstream.avg_frame_rate).split("/").map(Number);
    report.video.fps = dd ? Math.round((nn / dd) * 100) / 100 : null;
  }

  // duration vs expected
  const dur = report.video.durationSec;
  if (dur == null) {
    findings.push({ level: "warn", msg: "读不到时长" });
  } else if (expected.durationSec > 0) {
    const diff = Math.abs(dur - expected.durationSec);
    const tol = Math.max(0.5, expected.durationSec * 0.05);
    if (diff > expected.durationSec * 0.2) findings.push({ level: "error", msg: `成片时长 ${dur.toFixed(2)}s 与预期 ${expected.durationSec.toFixed(2)}s 差 ${diff.toFixed(2)}s(>20%)` });
    else if (diff > tol) findings.push({ level: "warn", msg: `成片时长 ${dur.toFixed(2)}s 与预期 ${expected.durationSec.toFixed(2)}s 略有出入(${diff.toFixed(2)}s)` });
  }
  // resolution vs project
  if (report.video.width && report.video.height && (report.video.width !== expected.width || report.video.height !== expected.height)) {
    findings.push({ level: "warn", msg: `分辨率 ${report.video.width}×${report.video.height} 与项目设定 ${expected.width}×${expected.height} 不一致` });
  }

  // ─ Frame sampling ─
  const qaDir = path.join(outputDir, "qa");
  try { fs.mkdirSync(qaDir, { recursive: true }); } catch {}
  const dchk = dur && dur > 0 ? dur : expected.durationSec || 1;
  const fracs = [0.06, 0.35, 0.66, 0.94];
  for (let i = 0; i < fracs.length; i++) {
    const t = Math.max(0, Math.min(dchk - 0.05, dchk * fracs[i]));
    const jpg = path.join(qaDir, `frame-${i + 1}.jpg`);
    const st = await sampleFrame(final, t, jpg);
    const tSec = Math.round(t * 100) / 100;
    if (st.yavg == null) {
      // Extraction failed → we genuinely don't know. Say so instead of silently
      // counting it as healthy content (which would mask an all-black render).
      findings.push({ level: "warn", msg: `第 ${i + 1} 抽样帧(t=${tSec}s)抽取失败 — 无法判定黑/空帧` });
      report.frames.push({ tSec, path: path.relative(projectRoot, jpg), yavg: null, black: false, flat: false });
      continue;
    }
    // The stitched final.mp4 is limited-range (TV) H.264, where true black is
    // luma 16 — NOT 0 — so the old `< 8` test could never fire on an all-black
    // render. Flag black when average luma is at/below limited-range black (plus
    // a little compression-noise margin) AND nothing bright appears anywhere
    // (ymax), so a legitimately dark design (nocturne ~#1b1612 → luma ~35, or any
    // frame carrying light text) is not misflagged as a broken frame.
    const black = st.yavg <= 20 && (st.ymax == null || st.ymax <= 40);
    const flat = st.ymin != null && st.ymax != null && st.ymax - st.ymin < 3;
    report.frames.push({ tSec, path: path.relative(projectRoot, jpg), yavg: st.yavg, black, flat });
  }
  const blackFrames = report.frames.filter((f) => f.black);
  const flatFrames = report.frames.filter((f) => f.flat && !f.black);
  if (report.frames.length && blackFrames.length === report.frames.length) {
    findings.push({ level: "error", msg: `抽样的 ${report.frames.length} 帧全是黑帧 — 成片很可能是坏的` });
  } else if (blackFrames.length) {
    findings.push({ level: "warn", msg: `${blackFrames.length}/${report.frames.length} 抽样帧是黑帧(t=${blackFrames.map((f) => f.tSec + "s").join(", ")})` });
  }
  if (flatFrames.length) findings.push({ level: "warn", msg: `${flatFrames.length} 帧内容近乎空白/纯色(t=${flatFrames.map((f) => f.tSec + "s").join(", ")})` });

  // ─ Delivery promise ─ If a promise was locked at approval, it — not the
  //   current disk state — is the source of truth for "what this video promised".
  //   This closes the silent-downgrade hole: a TTS run that failed leaves no mp3,
  //   so disk-sniffing would say "no audio expected" and bless a silent film;
  //   the promise remembers narration WAS intended and makes the missing mix an
  //   error. It also flags any scene/design/method drift since approval.
  const promise = loadPromise(outputDir);
  // ─ Audio ─
  const audioExpected = promise
    ? (promise.audio.voice || promise.audio.bgm)
    : ["voice-mixed.mp3", "voice-track.json", "bgm.mp3"].some((f) => fs.existsSync(path.join(outputDir, f)));
  report.audio.expected = audioExpected;
  report.audio.present = report.video.hasAudio;
  if (report.video.hasAudio) {
    const { meanDb, maxDb } = await audioLevels(final);
    report.audio.meanDb = meanDb;
    report.audio.maxDb = maxDb;
    report.audio.silent = maxDb != null && maxDb < -50;
    report.audio.clipping = maxDb != null && maxDb >= -0.1;
    if (report.audio.silent) findings.push({ level: "warn", msg: `音轨几乎无声(max ${maxDb} dB)` });
    if (report.audio.clipping) findings.push({ level: "warn", msg: `音频削波风险(max ${maxDb} dB ≥ 0)` });
  } else if (audioExpected) {
    findings.push({ level: "error", msg: "配了 TTS/BGM 但成片没有音轨 — 混音没生效" });
  }

  // ─ Promise drift ─ what changed between approval and delivery (warn-only:
  //   the user may have deliberately changed things, but it must never be silent).
  if (promise) {
    for (const msg of diffPromise(promise, sb)) findings.push({ level: "warn", msg: `承诺契约:${msg}` });
  }

  // ─ DIRECTION §四 审美验收自查表 (auto where possible, else 人工栏) ─
  report.checklist = buildChecklist(sb, report, projectRoot);
  const lintItem = report.checklist.find((c) => c.n === 6);
  if (lintItem?.status === "fail") findings.push({ level: "error", msg: `§四.6 土味 lint 未过:${lintItem.detail}` });
  const clWarn = report.checklist.filter((c) => c.status === "warn").length;
  const clPass = report.checklist.filter((c) => c.status === "pass").length;
  const clManual = report.checklist.filter((c) => c.status === "manual").length;
  if (clWarn) findings.push({ level: "warn", msg: `DIRECTION §四 自查 ${clWarn} 项需改(见 qa-report.checklist)` });
  findings.push({ level: "info", msg: `DIRECTION §四 自查:${clPass} 自动通过 / ${clWarn} 需改 / ${clManual} 待人工核对` });

  // ─ Verdict ─
  if (findings.some((f) => f.level === "error")) report.status = "fail";
  else if (findings.some((f) => f.level === "warn")) report.status = "warn";
  else { report.status = "pass"; findings.push({ level: "info", msg: "自检通过:容器有效、抽样帧有内容、音频正常;§四 自动项全过" }); }

  writeReport(outputDir, report);
  return report;
}

/**
 * DIRECTION §四 渲染后审美验收 checklist. Auto-judges what the storyboard +
 * QA data allow (silence, transitions, lint, method variety, audio, ending);
 * the rest (hook quality, emphasis-on-beat, one-focus, tabular scroll) are
 * content judgments left as `manual` rows for a human to tick.
 */
function buildChecklist(sb: Storyboard, report: QaReport, projectRoot: string): ChecklistItem[] {
  const scenes = sb.scenes ?? [];
  const n = scenes.length;
  const items: ChecklistItem[] = [];
  const add = (nn: number, label: string, status: ChecklistItem["status"], detail: string) =>
    items.push({ n: nn, label, status, detail });

  // 1. 开场 10s 内有钩子事件 — content judgment; flag a bare fallback opener.
  const s0 = scenes[0];
  if (s0 && s0.method === "hf-css-fade") add(1, "开场 10s 内有钩子事件", "warn", "开场是 hf-css-fade 纯文字兜底 — 确认真有钩子(数据/悬念/冲突)");
  else add(1, "开场 10s 内有钩子事件", "manual", "人工确认开场 10s 有钩子事件");

  // 2. 全片无 >6s 视觉静默段 — auto from storyboard.
  const longStatic = scenes.filter((s) =>
    s.durationSec > 6 && (s.assets?.length ?? 0) === 0 && !s.data && !s.foreground && (!s.motion || s.motion.kind === "still"));
  add(2, "全片无 >6s 视觉静默段", longStatic.length ? "warn" : "pass",
    longStatic.length ? `镜 ${longStatic.map((s) => s.index).join("/")} >6s 静态 — 拆镜或加事件` : "无 >6s 静默镜");

  // 3 / 4 — need audio-alignment / per-frame inspection: manual.
  add(3, "关键数据/关键词有强调动效,落点在发音区间", "manual", "对齐音轨人工核对");
  add(4, "同屏动效 ≤1 主 1 辅", "manual", "抽 3 处人工核对");

  // 5. 转场硬切为主、种类 ≤2、无糊脸 dissolve — auto from storyboard.
  const trans = scenes.slice(1).map((s) => (s as any).transition ?? "cut");
  const distinct = [...new Set(trans)];
  const hasDissolve = trans.some((t) => /dissolve/i.test(String(t)));
  const cutShare = trans.length ? trans.filter((t) => t === "cut").length / trans.length : 1;
  add(5, "转场硬切为主、种类 ≤2、无糊脸 dissolve",
    hasDissolve ? "fail" : distinct.length > 2 || cutShare < 0.5 ? "warn" : "pass",
    `转场 ${distinct.length} 种(${distinct.join("/") || "cut"}),硬切占 ${Math.round(cutShare * 100)}%${hasDissolve ? " — 含 dissolve!" : ""}`);

  // 6. 土味 lint 0 + 色彩出自 tokens — auto: regenerate each scene's source, lint it.
  let hits = 0; const badScenes: number[] = [];
  for (const s of scenes) {
    const r = s.method ? METHOD_RENDERERS[s.method] : undefined;
    if (!r) continue;
    try {
      const ctx = {
        width: sb.project.width, height: sb.project.height, fps: sb.project.fps,
        projectRoot, projectTitle: sb.project.title,
        design: resolveSceneDesign(sb.project.design, s.style),
      };
      const out: any = r(s, ctx as any);
      const h = lintSource(out.html ?? out.tsx ?? "");
      if (h.length) { hits += h.length; badScenes.push(s.index); }
    } catch { /* skip un-renderable scene */ }
  }
  add(6, "土味 lint 0 命中;色彩全部出自 design tokens", hits ? "fail" : "pass",
    hits ? `${hits} 处土味命中(镜 ${badScenes.join("/")})` : "lint 0 命中;方法均读 ctx.design tokens");

  // 7. 数字全部等宽 — the number methods are tabular by construction; scroll is manual.
  add(7, "数字全部等宽,滚动不抖", "manual", "数字方法(mega/stat-counter、d3、versus)均 tabular-nums;人工抽验滚动");

  // 8. method 重复率 ≤40%,相邻镜不同方法 — auto.
  const counts = new Map<string, number>();
  for (const s of scenes) counts.set(s.method ?? "∅", (counts.get(s.method ?? "∅") ?? 0) + 1);
  let top = 0, topId = ""; for (const [id, c] of counts) if (c > top) { top = c; topId = id; }
  const share = n ? top / n : 0;
  let adjacent = 0; for (let i = 1; i < n; i++) if (scenes[i].method && scenes[i].method === scenes[i - 1].method) adjacent++;
  add(8, "method 重复率 ≤40%,相邻镜不同方法为主", share > 0.4 || adjacent > 0 ? "warn" : "pass",
    `最常用 '${topId}' 占 ${Math.round(share * 100)}%(${top}/${n});相邻同法 ${adjacent} 处`);

  // 9. 音画 — auto from the audio probe above.
  if (!report.audio.expected) add(9, "音画:无削波/静音;BGM 不压解说", "manual", "本片无音轨(未配 TTS/BGM)");
  else if (report.audio.silent) add(9, "音画:无削波/静音;BGM 不压解说", "warn", "音轨近乎无声");
  else if (report.audio.clipping) add(9, "音画:无削波/静音;BGM 不压解说", "warn", "削波风险");
  else add(9, "音画:无削波/静音;BGM 不压解说", "pass", `mean ${report.audio.meanDb}dB / max ${report.audio.maxDb}dB;BGM 压不压解说需人工听`);

  // 10. 结尾定帧收束 ≥1.5s — auto from last scene duration.
  const last = scenes.at(-1);
  add(10, "结尾定帧收束 ≥1.5s", last && last.durationSec >= 1.5 ? "pass" : "warn",
    last ? `末镜 ${last.durationSec}s(方法 ${last.method ?? "?"})` : "无末镜");

  return items;
}

function writeReport(outputDir: string, report: QaReport): void {
  try { fs.writeFileSync(path.join(outputDir, "qa-report.json"), JSON.stringify(report, null, 2)); } catch {}
}

/** One-line summary for logs / task messages. */
export function summarizeReport(r: QaReport): string {
  const mark = r.status === "pass" ? "✓" : r.status === "warn" ? "⚠" : "✗";
  const errs = r.findings.filter((f) => f.level === "error").length;
  const warns = r.findings.filter((f) => f.level === "warn").length;
  const dur = r.video.durationSec != null ? `${r.video.durationSec.toFixed(1)}s` : "?";
  const cl = r.checklist ?? [];
  const clNote = cl.length
    ? ` · §四 ${cl.filter((c) => c.status === "pass").length}✓/${cl.filter((c) => c.status === "warn" || c.status === "fail").length}✗/${cl.filter((c) => c.status === "manual").length}人工`
    : "";
  return `${mark} 渲后自检 [${r.status}] ${dur} ${r.video.width ?? "?"}×${r.video.height ?? "?"} · ${errs} 错 / ${warns} 警${clNote}`;
}
