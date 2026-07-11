import { type MethodRenderer, pickGeneratedBg, sanitizeEase, pickForeground, escapeHtml } from "../kit.ts";
import { hfPosterHero } from "./hf-poster-hero.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-mountain-reveal — cinematic title that rises FROM BEHIND a matted
// mountain. The same plate is used twice: once as the full background, once
// (matted, transparent sky) as a pixel-registered foreground occluder. The
// title sits BETWEEN them, so as it translates up it is precisely hidden by
// the mountain silhouette and emerges through the notches beside the peak.
// Requires scene.foreground (a matte of the bg). Falls back to poster-hero.
// ──────────────────────────────────────────────────────────────────────────
export const hfMountainReveal: MethodRenderer = (scene, ctx) => {
  const bgImage = pickGeneratedBg(scene, ctx);
  const fg = pickForeground(scene, ctx);
  // Needs both the full plate AND a matte of it to do the occlusion trick.
  if (!bgImage || !fg) return hfPosterHero(scene, ctx);

  const dur = scene.durationSec;
  const m = scene.motion ?? { kind: "kenburns", direction: "in", intensity: "subtle", ease: "power2.inOut" };
  const kb = m.intensity === "strong" ? 0.12 : m.intensity === "medium" ? 0.08 : 0.055;
  const kbStart = m.direction === "out" ? 1 + kb : 1;
  const kbEnd   = m.direction === "out" ? 1 : 1 + kb;
  const ease = sanitizeEase(m.ease);

  const caption  = scene.notes?.[0] ?? (ctx.projectTitle ? `${ctx.projectTitle} · 第 ${String(scene.index).padStart(2, "0")} 帧` : `第 ${String(scene.index).padStart(2, "0")} 帧`);
  const subtitle = scene.notes?.[1] ?? "A CINEMATIC FRAME";

  // Timeline beats (seconds), clamped so short scenes still resolve.
  const tBars  = 0.0;
  const tRise  = Math.min(0.55, dur * 0.12);
  const dRise  = Math.min(2.6, dur * 0.52);
  const tChrome = Math.min(tRise + dRise + 0.15, dur - 0.6);
  // Start deep inside the opaque mountain body, end fully ABOVE the peak.
  // 0.52*H of travel: from ~75% (buried) to ~23% (clear sky) → 破山而出.
  const riseY  = Math.round(ctx.height * 0.52);

  return {
    engine: "hyperframes",
    sideFiles: { "bg.png": bgImage.absPath, "fg.png": fg.absPath },
    html: `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;900&family=Inter:wght@500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: #03040a; color: #f4ead0; font-family: "Inter", -apple-system, sans-serif; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; }

  /* Layer 0 — full plate (sky + mountain + sea) */
  .bg-img {
    position: absolute; inset: 0; z-index: 0;
    background-image: url('bg.png');
    background-size: cover; background-position: center;
    will-change: transform;
    filter: saturate(1.06) contrast(1.10) brightness(0.92);
  }
  /* (Removed the screen-blended volumetric glow — the 印刷工坊 aesthetic bans
     glow/AI-shimmer, and the 土味 lint's glow rule can't even see mix-blend-mode
     glows, so it was slipping through.) */
  /* Layer 2 — the title that rises from behind the mountain */
  .title-wrap {
    position: absolute; left: 0; right: 0; top: 23%;
    transform: translateY(-50%);
    text-align: center; z-index: 2;
    will-change: transform;
  }
  .title {
    display: inline-block;
    font-family: "Noto Serif SC", "PingFang SC", "Songti SC", serif;
    font-weight: 900;
    font-size: 150px;
    line-height: 1.0;
    letter-spacing: 0.05em;
    color: #f7f4ee;
    filter: drop-shadow(0 4px 18px rgba(0,0,0,0.55));
    white-space: nowrap;
  }
  /* Layer 3 — drifting mist that softens the occlusion seam */
  .mist {
    position: absolute; left: -10%; right: -10%; top: 40%;
    height: 38%; z-index: 3;
    background: linear-gradient(180deg, rgba(180,195,215,0) 0%, rgba(176,192,214,0.16) 45%, rgba(150,168,196,0.10) 75%, rgba(150,168,196,0) 100%);
    filter: blur(14px); opacity: 0.0; will-change: transform, opacity;
    pointer-events: none;
  }
  /* Layer 4 — matted mountain occluder, pixel-registered with .bg-img */
  .fg-mtn {
    position: absolute; inset: 0; z-index: 4;
    background-image: url('fg.png');
    background-size: cover; background-position: center;
    will-change: transform;
    filter: saturate(1.06) contrast(1.10) brightness(0.92);
  }
  /* Layer 5 — grade: vignette + faint film grain */
  .vignette {
    position: absolute; inset: 0; z-index: 5; pointer-events: none;
    background: radial-gradient(ellipse at 50% 44%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.34) 78%, rgba(0,0,0,0.62) 100%);
  }
  .grain {
    position: absolute; inset: -50%; z-index: 5; pointer-events: none; opacity: 0.06;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.5'/></svg>");
    mix-blend-mode: overlay;
  }
  /* Layer 6 — chrome (always readable, lives in the sky) */
  /* Chrome lives BELOW the mountain (over the sea) so the sky stays clean
     and the title owns the negative space it bursts into. */
  .chrome { position: absolute; left: 0; right: 0; z-index: 6; text-align: center; opacity: 0; }
  .caption {
    bottom: 23%;
    font-size: 22px; letter-spacing: 0.46em; text-transform: uppercase;
    color: rgba(240,196,99,0.92); font-weight: 600;
    text-shadow: 0 2px 12px rgba(0,0,0,0.85);
  }
  .rule { bottom: 20.5%; }
  .rule i { display: inline-block; width: 120px; height: 1px; background: linear-gradient(90deg, rgba(240,196,99,0), rgba(240,196,99,0.85), rgba(240,196,99,0)); }
  .subtitle {
    bottom: 16%;
    font-size: 17px; letter-spacing: 0.40em; text-transform: uppercase;
    color: rgba(244,234,208,0.66); font-weight: 500;
    text-shadow: 0 2px 10px rgba(0,0,0,0.85);
  }
  /* Layer 7 — letterbox bars */
  .bar { position: absolute; left: 0; right: 0; height: ${Math.round(ctx.height * 0.085)}px; background: #000; z-index: 7; }
  .bar-top { top: 0; }
  .bar-bot { bottom: 0; }
  /* Layer 8 — corner stamp */
  .stamp {
    position: absolute; right: 90px; bottom: ${Math.round(ctx.height * 0.085) + 26}px;
    font-size: 13px; letter-spacing: 0.5em; text-transform: uppercase;
    color: rgba(240,196,99,0.5); z-index: 8; opacity: 0;
  }
  .stamp::before { content:""; display:inline-block; width:22px; height:1px; background:rgba(240,196,99,0.5); margin-right:12px; vertical-align:middle; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${dur}" data-width="${ctx.width}" data-height="${ctx.height}">
  <div class="bg-img" data-layout-ignore></div>
  <div class="title-wrap" id="tw" data-layout-ignore><span class="title">${escapeHtml(scene.text)}</span></div>
  <div class="mist" id="mist" data-layout-ignore></div>
  <div class="fg-mtn" data-layout-ignore></div>
  <div class="vignette" data-layout-ignore></div>
  <div class="grain" id="grain" data-layout-ignore></div>
  <div class="chrome caption" id="cap" data-layout-ignore>${escapeHtml(caption)}</div>
  <div class="chrome rule" id="rule" data-layout-ignore><i></i></div>
  <div class="chrome subtitle" id="sub" data-layout-ignore>${escapeHtml(subtitle)}</div>
  <div class="bar bar-top" data-layout-ignore></div>
  <div class="bar bar-bot" data-layout-ignore></div>
  <div class="stamp" id="stamp" data-layout-ignore>${ctx.projectTitle ? escapeHtml(ctx.projectTitle) + " · " : ""}NO.${String(scene.index).padStart(3, "0")}</div>

  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    var H = ${ctx.height};
    var barH = ${Math.round(ctx.height * 0.085)};

    // Background + matte occluder ken-burns IN LOCKSTEP (same tween) so the
    // two layers stay pixel-registered — the mountain never doubles.
    tl.fromTo([".bg-img", ".fg-mtn"],
      { scale: ${kbStart}, transformOrigin: "50% 34%" },
      { scale: ${kbEnd.toFixed(3)}, duration: ${dur.toFixed(2)}, ease: "${ease}" }, 0);

    // Letterbox bars.
    tl.fromTo(".bar-top", { y: -barH }, { y: 0, duration: 0.7, ease: "expo.out" }, ${tBars});
    tl.fromTo(".bar-bot", { y:  barH }, { y: 0, duration: 0.7, ease: "expo.out" }, ${tBars});

    // THE REVEAL — title climbs out from behind the mountain. Starts deep,
    // blurred and wide; settles sharp. Mountain matte (z4) occludes the lower
    // glyphs until they clear the ridge.
    tl.set("#tw", { opacity: 1 }, 0);
    tl.fromTo("#tw",
      { y: ${riseY}, scale: 1.05, filter: "blur(9px)" },
      { y: 0, scale: 1.0, filter: "blur(0px)", duration: ${dRise.toFixed(2)}, ease: "expo.out" }, ${tRise.toFixed(2)});
    tl.fromTo(".title",
      { letterSpacing: "0.18em", opacity: 0.0 },
      { letterSpacing: "0.05em", opacity: 1, duration: ${(dRise * 0.7).toFixed(2)}, ease: "power2.out" }, ${tRise.toFixed(2)});

    // Mist drifts across the seam during the rise.
    tl.fromTo("#mist", { opacity: 0, x: -60 },
      { opacity: 1, x: 40, duration: ${Math.max(1.2, dur * 0.6).toFixed(2)}, ease: "sine.inOut" }, ${tRise.toFixed(2)});
    tl.to("#mist", { opacity: 0.4, x: 90, duration: ${Math.max(0.8, dur * 0.3).toFixed(2)}, ease: "sine.inOut" }, ">");

    // Faint grain shimmer.
    tl.fromTo("#grain", { x: 0, y: 0 }, { x: -40, y: 30, duration: ${dur.toFixed(2)}, ease: "none" }, 0);

    // Chrome fades up after the title has settled.
    tl.to(["#cap", "#rule"], { opacity: 1, duration: 0.7, ease: "power2.out" }, ${tChrome.toFixed(2)});
    tl.to("#sub",  { opacity: 1, duration: 0.7, ease: "power2.out" }, ${(tChrome + 0.2).toFixed(2)});
    tl.to("#stamp",{ opacity: 1, duration: 0.7, ease: "power2.out" }, ${(tChrome + 0.35).toFixed(2)});

    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
