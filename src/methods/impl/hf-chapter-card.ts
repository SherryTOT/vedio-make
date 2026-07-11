import { type MethodRenderer, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-chapter-card — 小Lin说-style dark/gold chapter title card.
//   scene.text convention (pipe-separated):  "第六章|多米诺骨牌|Dominoes|97-99"
//   → [chapterNo, titleCN, titleEN?, years?].  1 part → whole = titleCN.
// ──────────────────────────────────────────────────────────────────────────
export const hfChapterCard: MethodRenderer = (scene, ctx) => {
  const p = scene.text.split("|").map((s) => s.trim());
  const chapNo = (p.length > 1 ? p[0] : "") || "";
  const titleCN = (p.length > 1 ? p[1] : p[0]) || scene.text;
  const titleEN = p[2] || "";
  const years = p[3] || "";
  const d = scene.durationSec;
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
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    background: ${ctx.design.paper}; }
  .vig { display: none; }
  .chapno { font-family: ${ctx.design.sans}; font-size: 28px; letter-spacing: 0.34em; color: ${ctx.design.accent2}; opacity: 0;
    font-weight: 600; margin-bottom: 30px; padding-left: 0.34em; }
  .rule { width: 0; height: 3px; background: ${ctx.design.accent};
    margin: 30px 0; border-radius: 0; }
  .titlecn { font-size: 158px; font-weight: ${ctx.design.displayWeight}; letter-spacing: 0.04em; line-height: 1.06;
    font-family: ${ctx.design.display === "serif" ? ctx.design.serif : ctx.design.sans};
    color: ${ctx.design.ink}; opacity: 0; }
  .titleen { font-family: ${ctx.design.sans}; font-size: 30px; letter-spacing: 0.34em; text-transform: uppercase;
    color: ${ctx.design.muted}; opacity: 0; margin-top: 10px; }
  .years { font-family: ${ctx.design.sans}; margin-top: 44px; font-size: 24px; font-weight: 600; letter-spacing: 0.1em;
    color: ${ctx.design.pw}; background: ${ctx.design.accent}; padding: 8px 26px; border-radius: 4px; opacity: 0; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${d}" data-width="${ctx.width}" data-height="${ctx.height}">
  <div class="vig" data-layout-ignore></div>
  ${chapNo ? `<div class="chapno">${escapeHtml(chapNo)}</div>` : ""}
  <div class="titlecn">${escapeHtml(titleCN)}</div>
  ${titleEN ? `<div class="titleen">${escapeHtml(titleEN)}</div>` : ""}
  ${years ? `<div class="rule" data-layout-ignore></div><div class="years">${escapeHtml(years)}</div>` : `<div class="rule" data-layout-ignore></div>`}
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const T = ${d};
    tl.fromTo(".chapno", { opacity: 0, y: -16, letterSpacing: "28px" },
      { opacity: 1, y: 0, letterSpacing: "14px", duration: Math.min(0.7, T*0.5), ease: "power2.out" }, 0.15);
    tl.fromTo(".titlecn", { opacity: 0, y: 60, scale: 0.94 },
      { opacity: 1, y: 0, scale: 1, duration: Math.min(0.9, T*0.6), ease: "expo.out" }, 0.3);
    tl.fromTo(".titleen", { opacity: 0, y: 22 },
      { opacity: 1, y: 0, duration: Math.min(0.6, T*0.45), ease: "power3.out" }, 0.55);
    tl.fromTo(".rule", { width: 0 },
      { width: 360, duration: Math.min(0.8, T*0.5), ease: "power2.inOut" }, 0.5);
    tl.fromTo(".years", { opacity: 0, scale: 0.7 },
      { opacity: 1, scale: 1, duration: Math.min(0.5, T*0.4), ease: "back.out(2)" }, 0.75);
    // entrance only — concat handles the cut
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
