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
import type { Storyboard } from "./types.ts";

export interface QaFrame { tSec: number; path: string; yavg: number | null; black: boolean; flat: boolean }
export interface QaFinding { level: "error" | "warn" | "info"; msg: string }
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

  // ─ Verdict ─
  if (findings.some((f) => f.level === "error")) report.status = "fail";
  else if (findings.some((f) => f.level === "warn")) report.status = "warn";
  else { report.status = "pass"; findings.push({ level: "info", msg: "自检通过:容器有效、抽样帧有内容、音频正常" }); }

  writeReport(outputDir, report);
  return report;
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
  return `${mark} 渲后自检 [${r.status}] ${dur} ${r.video.width ?? "?"}×${r.video.height ?? "?"} · ${errs} 错 / ${warns} 警`;
}
