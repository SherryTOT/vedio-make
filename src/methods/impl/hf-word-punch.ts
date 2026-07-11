import { type MethodRenderer, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-word-punch — punchy keyword / 金句 reveal (GSAP).
//   MOTION.md §三.7: an accent block scaleX 0→1 (0.25s power3.out) sweeps in
//   first, then the text scale 1.3→1 lands (0.35s). Aligns to the word's beat.
//   Used sparingly (≤2 per 15s) — it's the emphasis money-shot.
//
//   scene.text = the punch line(s). Newlines make stacked punches that stagger.
//   Keep each line short (金句, ≤18 CJK chars — MOTION 红线 6).
// ──────────────────────────────────────────────────────────────────────────
export const hfWordPunch: MethodRenderer = (scene, ctx) => {
  const lines = scene.text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4);
  if (!lines.length) lines.push(scene.text.trim() || "");

  const usableW = ctx.width - 240;           // 120px safe margin each side
  // Per-line font size so the block (text + padding) never bleeds the safe area.
  const emWidth = (s: string) => {
    let w = 0;
    for (const ch of s) w += /[　-鿿]/.test(ch) ? 1 : /[A-Za-z0-9]/.test(ch) ? 0.58 : 0.5;
    return w;
  };
  const sizeFor = (s: string) => {
    const em = emWidth(s) + 0.7;             // + horizontal block padding (0.35em each side)
    return Math.max(48, Math.min(130, Math.floor(usableW / Math.max(em, 1))));
  };

  const d = scene.durationSec;
  const lineHtml = lines.map((ln, i) =>
    `  <div class="punch" data-i="${i}">
    <span class="block"></span>
    <span class="txt">${escapeHtml(ln)}</span>
  </div>`).join("\n");

  const lineScript = lines.map((_, i) => {
    const t = (0.3 + i * 0.55).toFixed(2);
    return `    tl.fromTo('.punch[data-i="${i}"] .block', { scaleX: 0 }, { scaleX: 1, duration: 0.25, ease: "power3.out" }, ${t});
    tl.fromTo('.punch[data-i="${i}"] .txt', { scale: 1.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: "power3.out" }, ${(0.3 + i * 0.55 + 0.1).toFixed(2)});`;
  }).join("\n");

  return {
    engine: "hyperframes",
    html: `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden;
    background: ${ctx.design.paper}; color: ${ctx.design.ink};
    font-family: ${ctx.design.serif}; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px;
    display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 28px; padding: 80px 120px; }
  .punch { position: relative; display: inline-flex; align-items: center; }
  .block { position: absolute; inset: 0; background: ${ctx.design.accent}; transform: scaleX(0); transform-origin: left center; z-index: 0; }
  .txt { position: relative; z-index: 1; display: inline-block; padding: 0.1em 0.35em; font-weight: ${ctx.design.displayWeight};
    color: ${ctx.design.paper}; letter-spacing: 0.01em; line-height: 1.15; white-space: nowrap; opacity: 0; will-change: transform; }
${lines.map((ln, i) => `  .punch[data-i="${i}"] .txt { font-size: ${sizeFor(ln)}px; }`).join("\n")}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${d}" data-width="${ctx.width}" data-height="${ctx.height}">
${lineHtml}
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const T = ${d};
${lineScript}
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
