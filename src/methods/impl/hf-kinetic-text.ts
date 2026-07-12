import { type MethodRenderer, pickGeneratedBg, onVeilText, buildMotionScript, buildFocusOverlay, pickForeground, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-kinetic-text — GSAP kinetic text for short hero phrases
// ──────────────────────────────────────────────────────────────────────────
export const hfKineticText: MethodRenderer = (scene, ctx) => {
  // Tokenise for per-unit animation: Latin/digit words stay whole, CJK animates
  // per char. Whitespace is not a token — it becomes a `w-sp` marker on the
  // preceding span. Without it "Claude Fable 5" fuses into "ClaudeFable5":
  // the flex column-gap (4px) is no word gap at 110px type.
  const raw = scene.text.replace(/\s+/g, " ").trim().match(/[A-Za-z0-9]+| |[一-鿿]|[^ A-Za-z0-9]/g) ?? [];
  const segments: { s: string; sp: boolean }[] = [];
  let pendingSp = false;
  for (const t of raw) {
    if (t === " ") { pendingSp = true; continue; }
    if (/^[，。、！？；：·,.]$/.test(t)) continue; // dropped punctuation, unchanged behavior
    if (pendingSp && segments.length) segments[segments.length - 1].sp = true;
    segments.push({ s: t, sp: false });
    pendingSp = false;
  }

  const wordEls = segments
    .map((seg, i) => `<span class="w${seg.sp ? " w-sp" : ""}" data-i="${i}">${escapeHtml(seg.s)}</span>`)
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
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; display: flex; align-items: center; justify-content: center; }
  .bg { position: absolute; inset: 0; background: ${ctx.design.paper}; }
  ${bgImage ? `.bg-img { position: absolute; inset: 0; background-image: url('bg.png'); background-size: cover; background-position: center; opacity: 0.92; filter: saturate(1.0) brightness(0.92) contrast(1.05); will-change: transform; } .bg-veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 60%, rgba(0,0,0,0.0) 30%, rgba(5,3,8,0.55) 95%); z-index: 1; }` : ""}
  ${fg ? `.fg-img { position: absolute; left: 60%; top: 12%; width: 36%; height: 76%; background-image: url('fg.png'); background-size: contain; background-repeat: no-repeat; background-position: center; z-index: 2; filter: drop-shadow(0 24px 48px rgba(0,0,0,0.6)); }` : ""}
  ${focusOverlay.css}
  .stage { display: flex; flex-wrap: wrap; gap: 8px 4px; padding: 0 120px; justify-content: center; max-width: ${ctx.width - 200}px; position: relative; z-index: 3; }
  .w { font-size: 110px; font-weight: 700; letter-spacing: 0.02em; line-height: 1.14; opacity: 0; transform-origin: 50% 100%; color: ${bgImage ? onVeilText(ctx.design) : ctx.design.ink}; }
  .w.w-sp { margin-right: 0.26em; } /* word gap where the source had whitespace */
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${scene.durationSec}" data-width="${ctx.width}" data-height="${ctx.height}">
  ${bgImage ? `<div class="bg-img" data-layout-ignore></div><div class="bg-veil" data-layout-ignore></div>` : `<div class="bg" data-layout-ignore></div>`}
  ${fg ? `<div class="fg-img" data-layout-ignore></div>` : ""}
  ${focusOverlay.html}
  <div class="stage">
    ${wordEls}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const words = document.querySelectorAll(".w");
    words.forEach((el, i) => {
      tl.fromTo(el, { opacity: 0, y: 34 }, { opacity: 1, y: 0, duration: Math.min(0.5, ${scene.durationSec} * 0.4), ease: "power3.out" }, 0.06 + i * Math.min(0.07, ${scene.durationSec} * 0.05));
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
