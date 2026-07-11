import { type MethodRenderer, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-tailwind-card — HyperFrames + Tailwind, product/feature tile
// ──────────────────────────────────────────────────────────────────────────
export const hfTailwindCard: MethodRenderer = (scene, ctx) => {
  // Try "label: description" → big label on top, sub-line under it.
  const m = scene.text.match(/^(.+?)[：:]\s*(.+)$/);
  const heading = m ? m[1].trim() : scene.text;
  const detail = m ? m[2].trim() : "";
  return {
    engine: "hyperframes",
    html: `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { box-sizing: border-box; }
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: ${ctx.design.paper}; font-family: ${ctx.design.sans}; }
</style>
</head>
<body class="text-cream">
<div id="root" data-composition-id="main" data-start="0" data-duration="${scene.durationSec}" data-width="${ctx.width}" data-height="${ctx.height}"
     style="position: relative; width:${ctx.width}px; height:${ctx.height}px; display:flex; align-items:center; justify-content:center;">
  <div class="absolute inset-0" data-layout-ignore
       style="background: ${ctx.design.paper};"></div>
  <div id="card"
       class="relative rounded-2xl p-16"
       style="width: 920px; min-height: 480px;
              background: ${ctx.design.pw};
              border: 1px solid ${ctx.design.line};
              border-left: 4px solid ${ctx.design.accent};
              opacity: 0;">
    <div class="text-xs tracking-[0.32em] uppercase mb-6" style="color: ${ctx.design.accent2};">FEATURE</div>
    <div id="head" class="text-7xl font-medium leading-tight" style="color: ${ctx.design.ink};">
      ${escapeHtml(heading)}
    </div>
    ${detail ? `<div id="sub" class="text-2xl mt-8 leading-relaxed max-w-3xl" style="color: ${ctx.design.ink2};">${escapeHtml(detail)}</div>` : ""}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#card",
      { opacity: 0, y: 40, rotationX: -8, transformPerspective: 900 },
      { opacity: 1, y: 0,  rotationX: 0,  duration: 0.7, ease: "power3.out" },
      0.1);
    tl.from("#head", { y: 18, opacity: 0, duration: 0.55, ease: "expo.out" }, 0.35);
    ${detail ? `tl.from("#sub", { y: 12, opacity: 0, duration: 0.45, ease: "power2.out" }, 0.55);` : ""}
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
