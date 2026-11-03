/**
 * `pipeline analyze --offline` — rule-based method picks for the zero-key path (no LLM call).
 * Only methods that render correctly from plain subtitle text are used: hf-stat-counter and
 * hf-chapter-card parse a pipe-separated text convention, so feeding them raw cues would misrender.
 * Scenes that already have a method (hand-picked or from an earlier analyze) are left alone.
 */
import type { Storyboard } from "./types.ts";

export const OFFLINE_SHORT_METHOD = "hf-kinetic-text"; // hero phrase, per-word motion
export const OFFLINE_LONG_METHOD = "hf-css-fade";      // plain caption, fits any length
const SHORT_MAX_CHARS = 14;

export function pickOfflineMethod(text: string): string {
  const visible = (text ?? "").replace(/\s/g, "").length;
  return visible > 0 && visible <= SHORT_MAX_CHARS && !text.includes("\n") ? OFFLINE_SHORT_METHOD : OFFLINE_LONG_METHOD;
}

/** Fill every scene without a method; returns how many were filled. Mutates `sb`. */
export function applyOfflinePicks(sb: Storyboard): number {
  let filled = 0;
  for (const sc of sb.scenes) {
    if (sc.method) continue;
    sc.method = pickOfflineMethod(sc.text);
    sc.fallback = sc.fallback ?? OFFLINE_LONG_METHOD;
    sc.reasoning = sc.reasoning ?? `离线规则(无 LLM):${sc.method === OFFLINE_SHORT_METHOD ? "短句 → 动态大字" : "长句 → 淡入字幕"}`;
    filled++;
  }
  sb.stages.analyzed = true;
  return filled;
}
