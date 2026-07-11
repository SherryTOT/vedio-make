import { type MethodRenderer, pickGeneratedBg, buildMotionScript, buildFocusOverlay, pickForeground, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-anime-scatter — list items fly in with stagger (Anime.js)
// ──────────────────────────────────────────────────────────────────────────
export const hfAnimeScatter: MethodRenderer = (scene, ctx) => {
  const items = scene.text
    .split(/[、,,·\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tiles = items
    .map((s, i) => `<div class="tile" data-i="${i}">${escapeHtml(s)}</div>`)
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
<script src="https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: ${ctx.design.paper}; color: ${ctx.design.ink}; font-family: ${ctx.design.serif}; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; display: flex; align-items: center; justify-content: center; }
  .bg { position: absolute; inset: 0; background: ${ctx.design.paper}; }
  ${bgImage ? `.bg-img { position: absolute; inset: 0; background-image: url('bg.png'); background-size: cover; background-position: center; opacity: 0.45; filter: saturate(0.7) brightness(0.6); will-change: transform; } .bg-veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 30% 70%, rgba(0,0,0,0.15) 0%, rgba(5,3,8,0.78) 75%); z-index: 1; }` : ""}
  ${fg ? `.fg-img { position: absolute; left: 70%; top: 14%; width: 26%; height: 72%; background-image: url('fg.png'); background-size: contain; background-repeat: no-repeat; background-position: center; z-index: 2; filter: drop-shadow(0 18px 38px rgba(0,0,0,0.5)); }` : ""}
  ${focusOverlay.css}
  .grid { display: flex; flex-wrap: wrap; gap: 18px 22px; padding: 0 140px; justify-content: center; max-width: ${ctx.width - 200}px; position: relative; z-index: 3; }
  .tile {
    padding: 16px 30px; font-size: 44px; font-weight: 600; letter-spacing: 0.02em;
    background: ${ctx.design.pw}; color: ${ctx.design.ink};
    border: 1px solid ${ctx.design.line};
    border-left: 3px solid ${ctx.design.accent};
    border-radius: 4px;
    opacity: 0;
  }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${scene.durationSec}" data-width="${ctx.width}" data-height="${ctx.height}">
  ${bgImage ? `<div class="bg-img" data-layout-ignore></div><div class="bg-veil" data-layout-ignore></div>` : `<div class="bg" data-layout-ignore></div>`}
  ${fg ? `<div class="fg-img" data-layout-ignore></div>` : ""}
  ${focusOverlay.html}
  <div class="grid">
    ${tiles}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const tiles = document.querySelectorAll(".tile");
    // Deterministic per-tile rotation/offset (seeded by index, not Math.random)
    tiles.forEach((el, i) => {
      const dx = ((i * 37) % 19) - 9;  // -9..+9
      const dy = ((i * 53) % 23) - 11; // -11..+11
      const rot = ((i * 23) % 11) - 5; // -5..+5
      tl.fromTo(el,
        { opacity: 0, x: dx * 6, y: dy * 4 - 60, rotation: rot * 1.5, scale: 0.7 },
        { opacity: 1, x: 0, y: 0, rotation: 0, scale: 1, duration: Math.min(0.55, ${scene.durationSec} * 0.35), ease: "back.out(1.7)" },
        0.05 + i * Math.min(0.09, ${scene.durationSec} * 0.06)
      );
    });
    ${motionScript}
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
