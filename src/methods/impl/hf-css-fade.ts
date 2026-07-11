import { type MethodRenderer, pickGeneratedBg, onVeilText, buildMotionScript, buildFocusOverlay, pickForeground, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-css-fade — universal fallback. Always safe.
// ──────────────────────────────────────────────────────────────────────────
export const hfCssFade: MethodRenderer = (scene, ctx) => {
  const lines = scene.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const safeLines = lines
    .map(
      (l, i) =>
        `<div class="line line-${i}">${escapeHtml(l)}</div>`
    )
    .join("\n      ");
  const bgImage = pickGeneratedBg(scene, ctx);
  const fg = pickForeground(scene, ctx);
  const motionScript = buildMotionScript(scene);
  const focusOverlay = buildFocusOverlay(scene);
  const sideFiles: Record<string, string> = {};
  if (bgImage) sideFiles["bg.png"] = bgImage.absPath;
  if (fg) sideFiles["fg.png"] = fg.absPath;
  return {
    engine: "hyperframes",
    sideFiles: Object.keys(sideFiles).length ? sideFiles : undefined,
    html: `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: ${ctx.design.paper}; color: ${ctx.design.ink}; font-family: ${ctx.design.serif}; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; padding: 0 130px; gap: 16px; }
  .bg { position: absolute; inset: 0; background: ${ctx.design.paper}; }
  .kicker { position: absolute; left: 130px; top: ${Math.round(ctx.height * 0.16)}px; display: flex; align-items: center; gap: 16px; font-family: ${ctx.design.sans}; font-size: ${Math.round(ctx.height * 0.017)}px; font-weight: 700; letter-spacing: 0.26em; color: ${ctx.design.accent2}; }
  .kicker .bar { display: inline-block; width: 52px; height: 3px; background: ${ctx.design.accent}; transform-origin: 0 50%; }
  ${bgImage ? `.bg-img { position: absolute; inset: 0; background-image: url('bg.png'); background-size: cover; background-position: center; opacity: 0.55; filter: saturate(0.85) brightness(0.7); will-change: transform; } .bg-veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5,3,8,0.4) 0%, rgba(5,3,8,0.78) 100%); z-index: 1; }` : ""}
  ${fg ? `.fg-img { position: absolute; left: 12%; top: 18%; width: 56%; height: 64%; background-image: url('fg.png'); background-size: contain; background-repeat: no-repeat; background-position: center; z-index: 2; filter: drop-shadow(0 20px 40px rgba(0,0,0,0.5)); }` : ""}
  ${focusOverlay.css}
  .line { position: relative; font-size: 62px; font-weight: 600; line-height: 1.55; letter-spacing: 0.01em; text-align: left; color: ${bgImage ? onVeilText(ctx.design) : ctx.design.ink}; opacity: 0; max-width: ${ctx.width - 260}px; z-index: 3; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${scene.durationSec}" data-width="${ctx.width}" data-height="${ctx.height}">
  ${bgImage ? `<div class="bg-img" data-layout-ignore></div><div class="bg-veil" data-layout-ignore></div>` : `<div class="bg" data-layout-ignore></div>`}
  ${fg ? `<div class="fg-img" data-layout-ignore></div>` : ""}
  ${focusOverlay.html}
  <div class="kicker" data-layout-ignore><span class="bar" id="kbar"></span><span>镜 ${String(scene.index).padStart(2, "0")}</span></div>
  ${safeLines}
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#kbar", { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: Math.min(0.5, ${scene.durationSec} * 0.3), ease: "power3.out" }, 0.05);
    const lines = document.querySelectorAll(".line");
    lines.forEach((el, i) => {
      tl.fromTo(el, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: Math.min(0.55, ${scene.durationSec} * 0.4), ease: "power3.out" }, 0.05 + i * Math.min(0.18, ${scene.durationSec} * 0.15));
    });
    ${motionScript}
    // No fade-out — concat between scenes is the cut.
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
