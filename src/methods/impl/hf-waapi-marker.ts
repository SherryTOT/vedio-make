import { type MethodRenderer, pickGeneratedBg, onVeilText, buildMotionScript, buildFocusOverlay, pickForeground, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-waapi-marker — highlight a phrase with a gold marker sweep
// ──────────────────────────────────────────────────────────────────────────
export const hfWaapiMarker: MethodRenderer = (scene, ctx) => {
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
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; display: flex; align-items: center; justify-content: center; }
  .bg { position: absolute; inset: 0; background: ${ctx.design.paper}; }
  ${bgImage ? `.bg-img { position: absolute; inset: 0; background-image: url('bg.png'); background-size: cover; background-position: center; opacity: 0.45; filter: saturate(0.8) brightness(0.55); will-change: transform; } .bg-veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0.1) 0%, rgba(5,3,8,0.82) 70%); z-index: 1; }` : ""}
  ${fg ? `.fg-img { position: absolute; left: 16%; top: 10%; width: 28%; height: 80%; background-image: url('fg.png'); background-size: contain; background-repeat: no-repeat; background-position: center; z-index: 2; filter: drop-shadow(0 22px 44px rgba(0,0,0,0.6)); }` : ""}
  ${focusOverlay.css}
  .phrase {
    position: relative; padding: 12px 18px;
    font-size: 86px; font-weight: 700; letter-spacing: 0.02em;
    color: ${bgImage ? onVeilText(ctx.design) : ctx.design.ink}; line-height: 1.28;
    max-width: ${ctx.width - 240}px; text-align: center;
    opacity: 0;
    z-index: 3;
  }
  .marker {
    position: absolute; left: 0; bottom: 12px;
    height: 26px; width: 0%;
    background: ${ctx.design.accent}; opacity: 0.30;
    z-index: -1;
    transform-origin: 0 50%;
    border-radius: 2px;
  }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${scene.durationSec}" data-width="${ctx.width}" data-height="${ctx.height}">
  ${bgImage ? `<div class="bg-img" data-layout-ignore></div><div class="bg-veil" data-layout-ignore></div>` : `<div class="bg" data-layout-ignore></div>`}
  ${fg ? `<div class="fg-img" data-layout-ignore></div>` : ""}
  ${focusOverlay.html}
  <div class="phrase" id="phrase">
    <span class="marker" id="marker" data-layout-ignore></span>
    ${escapeHtml(scene.text)}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // Phrase fades in
    tl.fromTo("#phrase", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: Math.min(0.55, ${scene.durationSec} * 0.3), ease: "power3.out" }, 0.1);
    // Marker sweeps under the phrase (uses Web Animations API via raw Element.animate())
    const phrase = document.getElementById("phrase");
    const marker = document.getElementById("marker");
    // Sweep starts ~0.45s after phrase enters
    tl.fromTo(marker,
      { width: "0%", opacity: 0 },
      { width: "100%", opacity: 1, duration: Math.min(0.9, ${scene.durationSec} * 0.5), ease: "expo.out" },
      Math.min(0.6, ${scene.durationSec} * 0.35)
    );
    ${motionScript}
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
