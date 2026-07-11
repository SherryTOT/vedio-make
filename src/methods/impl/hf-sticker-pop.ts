import { type MethodRenderer } from "../kit.ts";
import { hfCssFade } from "./hf-css-fade.ts";
import fs from "node:fs";
import path from "node:path";


// ──────────────────────────────────────────────────────────────────────────
// hf-sticker-pop — entity stickers take the stage (GSAP).
//   MOTION.md §三.5: matte-cut subjects pop in scale 0.6→1 back.out(1.4) 0.5s
//   with a ±8°→±2° settle, idle-sway rotate ±1.5° on a 4–6s sine.inOut loop,
//   and exit shrink+fade 0.3s. ≤4 stickers on screen.
//
//   Stickers = transparent PNGs in scene.assets (white-bg 生图 → matte 抠像 → P2).
//   No sticker assets → falls back to hf-css-fade so the pipeline keeps producing.
// ──────────────────────────────────────────────────────────────────────────
const LAYOUTS: Record<number, Array<[number, number, number]>> = {
  1: [[0.5, 0.5, 0.62]],
  2: [[0.5, 0.31, 0.52], [0.5, 0.69, 0.52]],
  3: [[0.5, 0.27, 0.44], [0.31, 0.68, 0.44], [0.69, 0.68, 0.44]],
  4: [[0.31, 0.31, 0.44], [0.69, 0.31, 0.44], [0.31, 0.69, 0.44], [0.69, 0.69, 0.44]],
};

export const hfStickerPop: MethodRenderer = (scene, ctx) => {
  const imgs = (scene.assets ?? [])
    .filter((a) => /\.(png|webp)$/i.test(a))
    .map((a) => ({ rel: a, abs: path.resolve(ctx.projectRoot, "assets", a) }))
    .filter((a) => fs.existsSync(a.abs))
    .slice(0, 4);
  if (!imgs.length) return hfCssFade(scene, ctx);

  const N = imgs.length;
  const W = ctx.width, H = ctx.height;
  const layout = LAYOUTS[N];
  const d = scene.durationSec;
  const exitAt = Math.max(1.2, d - 0.3);

  const sideFiles: Record<string, string> = {};
  const stickerHtml = imgs.map((im, i) => {
    const fn = `sticker-${i}-${path.basename(im.abs)}`;
    sideFiles[fn] = im.abs;
    const [cx, cy, s] = layout[i];
    const box = Math.round(s * W);
    return `  <div class="sticker" data-i="${i}" data-layout-ignore style="left:${Math.round(cx * W - box / 2)}px; top:${Math.round(cy * H - box / 2)}px; width:${box}px; height:${box}px;"><img src="${fn}" alt="" /></div>`;
  }).join("\n");

  const script = imgs.map((_, i) => {
    const popStart = 0.2 + i * 0.15;
    const land = i % 2 === 0 ? 2 : -2;
    const rotFrom = i % 2 === 0 ? 8 : -8;
    const swayTo = land + (i % 2 === 0 ? -3 : 3);         // ±1.5° around the landing tilt
    const swayStart = popStart + 0.5;
    const swayN = Math.max(1, Math.floor((exitAt - swayStart) / 2.5)); // finite (no repeat:-1)
    return `    tl.fromTo('.sticker[data-i="${i}"]', { scale: 0.6, rotation: ${rotFrom}, opacity: 0 }, { scale: 1, rotation: ${land}, opacity: 1, duration: 0.5, ease: "back.out(1.4)" }, ${popStart.toFixed(2)});
    tl.to('.sticker[data-i="${i}"]', { rotation: ${swayTo}, duration: 2.5, ease: "sine.inOut", repeat: ${swayN}, yoyo: true }, ${swayStart.toFixed(2)});
    tl.to('.sticker[data-i="${i}"]', { scale: 0.6, opacity: 0, duration: 0.3, ease: "power2.in" }, ${exitAt.toFixed(2)});`;
  }).join("\n");

  return {
    engine: "hyperframes",
    sideFiles,
    html: `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden;
    background: ${ctx.design.paper}; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${W}px; height: ${H}px; }
  .sticker { position: absolute; transform-origin: center center; opacity: 0; will-change: transform; }
  .sticker img { width: 100%; height: 100%; object-fit: contain; display: block; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${d}" data-width="${W}" data-height="${H}">
${stickerHtml}
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const T = ${d};
${script}
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
