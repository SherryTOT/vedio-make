import { type MethodRenderer, pickGeneratedBg, sanitizeEase, escapeHtml } from "../kit.ts";
import { hfKineticText } from "./hf-kinetic-text.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-poster-hero — proper cinematic poster typography on a hero image
//
// Layout (1920×1080):
//   bg image fills frame, slow kenburns
//   letterbox bars top/bottom (90px each) for 2.4:1 cinema feel
//   right-side typography column (anchored x=58%, vertically centered):
//     small ALL-CAPS caption ("CHAPTER 01 · 2026")
//     thin gold horizontal rule (80px)
//     hero phrase in Noto Serif SC weight 900 (~144px)
//     thin gold rule + subtitle ("CINEMATIC ESSAY")
//     date/series badge bottom-right corner
//
// Designed to make the bg image and the typography both feel intentional —
// the picture has a SIDE, the text has a SIDE, they don't fight each other.
// ──────────────────────────────────────────────────────────────────────────
export const hfPosterHero: MethodRenderer = (scene, ctx) => {
  const bgImage = pickGeneratedBg(scene, ctx);
  if (!bgImage) return hfKineticText(scene, ctx);

  const m = scene.motion ?? { kind: "kenburns", direction: "in", intensity: "subtle", ease: "power3.inOut" };
  const intensity = m.intensity === "strong" ? 0.18 : m.intensity === "medium" ? 0.10 : 0.05;
  const startScale = m.direction === "out" ? 1 + intensity : 1;
  const endScale   = m.direction === "out" ? 1 : 1 + intensity;
  const ease = sanitizeEase(m.ease);

  // Display copy: hero text is the cue itself. Caption / subtitle from
  // scene.notes if provided, else sensible defaults so the poster has chrome.
  const caption  = scene.notes?.[0] ?? "CINEMATIC ESSAY · 2026";
  const subtitle = scene.notes?.[1] ?? "A POETIC FRAME";

  return {
    engine: "hyperframes",
    sideFiles: { "bg.png": bgImage.absPath },
    html: `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;900&family=Inter:wght@500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: #050308; color: #f4ead0; font-family: "Inter", -apple-system, sans-serif; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; }
  .bg { position: absolute; inset: 0; }
  .bg-img {
    position: absolute; inset: 0;
    background-image: url('bg.png');
    background-size: cover; background-position: center;
    will-change: transform;
    filter: saturate(1.05) contrast(1.08);
  }
  /* Letterbox bars — gives the 'cinema' feel without literally cropping */
  .bar { position: absolute; left: 0; right: 0; height: 96px; background: #000; z-index: 5; }
  .bar-top { top: 0; }
  .bar-bot { bottom: 0; }
  /* Subtle right-side gradient to anchor the typography over the brightest area */
  .text-veil {
    position: absolute; inset: 0;
    background: linear-gradient(to left, rgba(5,3,8,0.62) 0%, rgba(5,3,8,0.30) 35%, rgba(5,3,8,0.05) 60%, rgba(5,3,8,0) 75%);
    z-index: 2;
  }

  /* Typography column — right side of the frame, vertically centered */
  .col {
    position: absolute; right: 130px; top: 50%;
    transform: translateY(-50%);
    width: 720px;
    z-index: 3;
    display: flex; flex-direction: column; gap: 22px;
    align-items: flex-start;
    opacity: 0;
  }
  .caption {
    font-size: 22px;
    letter-spacing: 0.42em;
    color: ${ctx.design.accent};
    text-transform: uppercase;
    font-weight: 500;
    text-shadow: 0 1px 8px rgba(0,0,0,0.7);
  }
  .rule {
    width: 96px; height: 1px;
    background: ${ctx.design.accent};
  }
  .hero {
    font-family: "Noto Serif SC", "PingFang SC", "Songti SC", serif;
    font-weight: 900;
    font-size: 168px;
    line-height: 1.0;
    letter-spacing: 0.04em;
    color: #f7f4ee;
    text-shadow: 0 2px 14px rgba(0,0,0,0.5);
    white-space: nowrap;
  }
  .subtitle {
    font-size: 18px;
    letter-spacing: 0.34em;
    color: rgba(244, 234, 208, 0.62);
    text-transform: uppercase;
    font-weight: 500;
    text-shadow: 0 1px 6px rgba(0,0,0,0.7);
  }

  /* Bottom-right corner stamp */
  .stamp {
    position: absolute; right: 140px; bottom: 140px;
    font-size: 14px;
    letter-spacing: 0.5em;
    color: rgba(212,166,74,0.55);
    z-index: 4;
    opacity: 0;
    text-transform: uppercase;
  }
  .stamp::before {
    content: ""; display: inline-block;
    width: 24px; height: 1px;
    background: rgba(212,166,74,0.55);
    margin-right: 14px; vertical-align: middle;
  }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${scene.durationSec}" data-width="${ctx.width}" data-height="${ctx.height}">
  <div class="bg" data-layout-ignore>
    <div class="bg-img" data-layout-ignore></div>
  </div>
  <div class="text-veil" data-layout-ignore></div>
  <div class="bar bar-top" data-layout-ignore></div>
  <div class="bar bar-bot" data-layout-ignore></div>

  <div class="col" id="col">
    <div class="caption" id="cap">${escapeHtml(caption)}</div>
    <div class="rule" id="r1"></div>
    <div class="hero" id="hero">${escapeHtml(scene.text)}</div>
    <div class="rule" id="r2"></div>
    <div class="subtitle" id="sub">${escapeHtml(subtitle)}</div>
  </div>
  <div class="stamp" id="stamp">${ctx.projectTitle ? escapeHtml(ctx.projectTitle) + " · " : ""}IMG ${String(scene.index).padStart(3, "0")}</div>

  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });

    // Kenburns over the full duration — gentle, NOT distracting.
    tl.fromTo(".bg-img",
      { scale: ${startScale}, transformOrigin: "30% 50%" },
      { scale: ${endScale.toFixed(3)}, duration: ${scene.durationSec.toFixed(2)}, ease: "${ease}" },
      0
    );
    // Letterbox bars slide in (cinematic title-card cue).
    tl.fromTo(".bar-top", { y: -96 }, { y: 0, duration: 0.7, ease: "expo.out" }, 0.0);
    tl.fromTo(".bar-bot", { y:  96 }, { y: 0, duration: 0.7, ease: "expo.out" }, 0.0);

    // Typography reveal — caption first, rule draws, hero pops, rule, subtitle.
    tl.set("#col", { opacity: 1 }, 0);
    tl.fromTo("#cap",  { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.55, ease: "power3.out" }, 0.5);
    tl.fromTo("#r1",   { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: 0.45, ease: "power3.out" }, 0.75);
    tl.fromTo("#hero", { opacity: 0, y: 36, letterSpacing: "0.12em" }, { opacity: 1, y: 0, letterSpacing: "0.04em", duration: 1.1, ease: "expo.out" }, 0.9);
    tl.fromTo("#r2",   { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: 0.45, ease: "power3.out" }, 1.55);
    tl.fromTo("#sub",  { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.55, ease: "power3.out" }, 1.75);
    tl.fromTo("#stamp",{ opacity: 0 }, { opacity: 1, duration: 0.7, ease: "power2.out" }, 2.1);

    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
