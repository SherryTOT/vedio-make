import path from "node:path";
import { type MethodRenderer, escapeHtml } from "../kit.ts";
import { hfCssFade } from "./hf-css-fade.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-lottie-play — HyperFrames + lottie-web for a .lottie or .json animation
// ──────────────────────────────────────────────────────────────────────────
export const hfLottiePlay: MethodRenderer = (scene, ctx) => {
  // Only plain .json Lottie files — lottie-web cannot load a .lottie (dotLottie
  // zip), which would leave a silently blank stage. Fall back to css-fade otherwise.
  const lottieAsset = (scene.assets ?? []).find((a) => /\.json$/i.test(a));
  if (!lottieAsset) return hfCssFade(scene, ctx);
  const absPath = path.resolve(ctx.projectRoot, "assets", lottieAsset);
  const fileName = "anim" + path.extname(absPath); // local file alongside index.html
  return {
    engine: "hyperframes",
    sideFiles: { [fileName]: absPath },
    html: `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: ${ctx.design.paper}; color: ${ctx.design.ink}; font-family: ${ctx.design.sans}; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 36px; }
  .bg { position: absolute; inset: 0; background: ${ctx.design.paper}; }
  #stage { width: 60%; height: 60%; opacity: 0; }
  .caption { font-size: 40px; letter-spacing: 0.04em; color: ${ctx.design.ink}; opacity: 0; text-align: center; max-width: 80%; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${scene.durationSec}" data-width="${ctx.width}" data-height="${ctx.height}">
  <div class="bg" data-layout-ignore></div>
  <div id="stage"></div>
  <div class="caption">${escapeHtml(scene.text)}</div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // Load Lottie. lottie-web's renderer is canvas (works under hyperframes seeking).
    const anim = lottie.loadAnimation({
      container: document.getElementById("stage"),
      renderer: "svg",
      loop: false,
      autoplay: false,
      path: "${fileName}",
    });
    // We drive the Lottie playhead from GSAP time so hyperframes' deterministic seek works.
    let totalFrames = 1;
    anim.addEventListener("DOMLoaded", () => {
      totalFrames = anim.totalFrames || 1;
    });
    tl.fromTo("#stage", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.6, ease: "power3.out" }, 0.1);
    tl.fromTo(".caption", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out" }, 0.5);
    // A linear tween proxy that updates Lottie frame each tick.
    const proxy = { p: 0 };
    tl.to(proxy, {
      p: 1,
      duration: ${scene.durationSec.toFixed(2)},
      ease: "none",
      onUpdate: () => anim.goToAndStop(Math.round(proxy.p * totalFrames), true),
    }, 0);
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
