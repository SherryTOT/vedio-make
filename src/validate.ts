/**
 * Pre-render structural validation — a cheap gate that runs BEFORE any scene is
 * rendered, so a broken storyboard fails in milliseconds instead of after
 * minutes of wasted render + a silently-broken final.mp4.
 *
 * Clean-room design (inspired by OpenMontage's composition_validator, but
 * reimplemented for Vedio Make's storyboard shape and MIT-licensed).
 *
 * Errors block a full render (unless --force / skipValidate); warnings are
 * advisory and only logged. Findings mirror the 土味 lint shape/voice.
 */
import fs from "node:fs";
import path from "node:path";
import { METHOD_RENDERERS } from "./methods/registry.ts";
import type { Storyboard } from "./types.ts";

export type Level = "error" | "warn";
export interface ValidateFinding {
  level: Level;
  /** 1-based scene index, or undefined for storyboard-wide findings. */
  scene?: number;
  code: string;
  msg: string;
}

/** Does an asset path resolve to a real file under any of the usual roots? */
function assetExists(projectRoot: string, rel: string, underAssets: boolean): boolean {
  const candidates = underAssets
    ? [path.resolve(projectRoot, "assets", rel), path.resolve(projectRoot, rel)]
    : [path.resolve(projectRoot, rel), path.resolve(projectRoot, "assets", rel)];
  return candidates.some((p) => {
    try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
  });
}

/**
 * Validate a storyboard's structure. `onlyIndex` restricts scene-level checks to
 * a single scene (for --only renders); undefined validates the whole board.
 */
export function validateStoryboard(
  sb: Storyboard,
  projectRoot: string,
  onlyIndex?: number | null,
): ValidateFinding[] {
  const f: ValidateFinding[] = [];
  const add = (level: Level, code: string, msg: string, scene?: number) => f.push({ level, code, msg, scene });

  // ─ Project-level ─
  const p = sb.project;
  if (!(p.width > 0 && p.height > 0)) add("error", "bad-dimensions", `画布尺寸非法(${p.width}×${p.height})`);
  if (!(p.fps >= 1 && p.fps <= 120)) add("error", "bad-fps", `帧率非法(fps=${p.fps},应在 1–120)`);
  if (!sb.scenes?.length) { add("error", "no-scenes", "没有镜头可渲染"); return f; }

  // ─ Index uniqueness ─
  const seen = new Map<number, number>();
  for (const s of sb.scenes) seen.set(s.index, (seen.get(s.index) ?? 0) + 1);
  for (const [idx, n] of seen) if (n > 1) add("error", "dup-index", `镜头序号 #${idx} 重复了 ${n} 次`, idx);

  const scenes = onlyIndex != null ? sb.scenes.filter((s) => s.index === onlyIndex) : sb.scenes;

  // ─ Per-scene ─
  for (const s of scenes) {
    const at = s.index;
    // method present + has a renderer
    if (!s.method) {
      add("error", "no-method", `镜头 #${at} 未指定方法(method),无法渲染 → final.mp4 永远拼不出来`, at);
    } else if (!METHOD_RENDERERS[s.method]) {
      add("error", "unknown-method", `镜头 #${at} 的方法 '${s.method}' 没有对应渲染器`, at);
    }
    // fallback sanity
    if (s.fallback && !METHOD_RENDERERS[s.fallback]) {
      add("warn", "unknown-fallback", `镜头 #${at} 的 fallback '${s.fallback}' 没有对应渲染器`, at);
    }
    // timing
    if (!(s.durationSec > 0)) add("error", "bad-duration", `镜头 #${at} 时长非法(durationSec=${s.durationSec})`, at);
    if (!(s.startSec < s.endSec)) add("error", "bad-timing", `镜头 #${at} 时间轴非法(start=${s.startSec} ≥ end=${s.endSec})`, at);
    const span = s.endSec - s.startSec;
    if (s.durationSec > 0 && Math.abs(span - s.durationSec) > 0.06) {
      add("warn", "duration-mismatch", `镜头 #${at} 时长(${s.durationSec}s)与 start→end 跨度(${span.toFixed(2)}s)不一致`, at);
    }
    // assets exist (advisory — resolution conventions vary, don't false-block)
    for (const a of s.assets ?? []) {
      if (!assetExists(projectRoot, a, false)) add("warn", "missing-asset", `镜头 #${at} 引用的素材找不到:${a}`, at);
    }
    if (s.foreground && !assetExists(projectRoot, s.foreground, true)) {
      add("error", "missing-foreground", `镜头 #${at} 的前景抠像 PNG 找不到:assets/${s.foreground}(渲染会崩)`, at);
    }
  }

  // ─ Contiguity (full-board only): gaps aren't filled by the stitcher ─
  if (onlyIndex == null) {
    const ordered = [...sb.scenes].sort((a, b) => a.startSec - b.startSec);
    for (let i = 1; i < ordered.length; i++) {
      const gap = ordered[i].startSec - ordered[i - 1].endSec;
      if (gap > 0.06) add("warn", "timeline-gap", `镜头 #${ordered[i - 1].index}→#${ordered[i].index} 之间有 ${gap.toFixed(2)}s 空隙(拼接不会补,字幕会漂)`, ordered[i].index);
      if (gap < -0.06) add("warn", "timeline-overlap", `镜头 #${ordered[i - 1].index}→#${ordered[i].index} 时间重叠 ${(-gap).toFixed(2)}s`, ordered[i].index);
    }
  }

  return f;
}

/** Convenience: split findings into errors vs warnings. */
export function splitFindings(f: ValidateFinding[]): { errors: ValidateFinding[]; warnings: ValidateFinding[] } {
  return { errors: f.filter((x) => x.level === "error"), warnings: f.filter((x) => x.level === "warn") };
}
