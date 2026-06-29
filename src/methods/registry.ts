/**
 * Method renderers — one function per method.id. Each takes a Scene and a
 * project-wide context, and produces either:
 *   { engine: "hyperframes", html: "..." }   — full HTML file for hyperframes render
 *   { engine: "remotion",    tsx:  "...", compId: "MyComp", props: {...} }
 *
 * The dispatcher in render.ts writes the source to a temp folder, invokes
 * the appropriate renderer (npx hyperframes render OR npx remotion render),
 * and returns the resulting MP4 path.
 *
 * Adding a method = write a new function here + register in METHOD_RENDERERS.
 */

import fs from "node:fs";
import path from "node:path";
import type { Scene, ResolvedDesign } from "../types.ts";
import { resolveDesign } from "./designs.ts";

// Legacy default for methods not yet ported to ctx.design (= inkwork preset).
// resolveDesign(undefined) returns inkwork tokens incl. terra/terra2 aliases,
// so existing BRAND token reads keep compiling. Remove once all read ctx.design.
const BRAND = resolveDesign(undefined);

/** Look up the first generated bg image in scene.assets and return its absolute path. */
function pickGeneratedBg(scene: Scene): { rel: string; absPath: string } | null {
  // We resolve via process.cwd() (project root for the CLI). The sideFiles
  // contract copies whatever path we return to the scene's temp folder.
  for (const rel of scene.assets ?? []) {
    if (!rel.startsWith("generated/")) continue;
    const abs = path.resolve(process.cwd(), "assets", rel);
    if (fs.existsSync(abs)) return { rel, absPath: abs };
  }
  return null;
}

/** Map intensity → scale delta (how much zoom). */
function intensityScale(intensity: "subtle" | "medium" | "strong" | undefined): number {
  if (intensity === "strong") return 0.22;
  if (intensity === "medium") return 0.14;
  return 0.06; // subtle default
}

/**
 * Build a small GSAP snippet that animates `.bg-img` (and `.fg-img` in opposite
 * direction for parallax depth) based on scene.motion. Always non-linear ease.
 * Returns the JS snippet or empty string for "still".
 *
 * Parallax: when a foreground (matted PNG) is present and the background does
 * a Ken Burns zoom-in, the foreground does a SMALLER zoom-in OR slight counter
 * pan. The differential motion creates depth perception (like Apple's photo
 * memories or news b-roll).
 */
function buildMotionScript(scene: Scene): string {
  const m = scene.motion;
  if (!m || m.kind === "still") return "";
  const dur = scene.durationSec;
  const ease = m.ease || "power3.inOut";
  const delta = intensityScale(m.intensity);
  const hasFg = Boolean(scene.foreground);

  if (m.kind === "kenburns" || m.kind === "dolly") {
    const dir = m.direction === "out" ? "out" : "in";
    const fromScale = dir === "in" ? 1.0 : 1.0 + delta;
    const toScale = dir === "in" ? 1.0 + delta : 1.0;
    // Parallax foreground: smaller delta (40% of bg) + slight horizontal pan
    const fgFromScale = dir === "in" ? 1.0 : 1.0 + delta * 0.4;
    const fgToScale = dir === "in" ? 1.0 + delta * 0.4 : 1.0;
    const fgDriftPx = (delta * 30).toFixed(1); // px counter-pan
    return `
    // Ken Burns (${m.kind}, ${dir}, intensity=${m.intensity ?? "subtle"}, ease=${ease})
    tl.fromTo(".bg-img",
      { scale: ${fromScale}, transformOrigin: "50% 50%" },
      { scale: ${toScale.toFixed(3)}, duration: ${dur.toFixed(2)}, ease: "${ease}" },
      0
    );${hasFg ? `
    // Parallax fg — slower zoom + slight counter-pan for depth
    tl.fromTo(".fg-img",
      { scale: ${fgFromScale.toFixed(3)}, x: -${fgDriftPx}, transformOrigin: "50% 50%" },
      { scale: ${fgToScale.toFixed(3)}, x: ${fgDriftPx}, duration: ${dur.toFixed(2)}, ease: "${ease}" },
      0
    );` : ""}`;
  }
  if (m.kind === "pan") {
    const offset = delta * 80; // px offset for pan
    const fromX = m.direction === "right" ? -offset : m.direction === "left" ? offset : 0;
    const fromY = m.direction === "down" ? -offset : m.direction === "up" ? offset : 0;
    return `
    // Pan (${m.direction ?? "right"}, intensity=${m.intensity ?? "subtle"})
    tl.fromTo(".bg-img",
      { x: ${fromX}, y: ${fromY}, scale: 1.08 },
      { x: 0, y: 0, duration: ${dur.toFixed(2)}, ease: "${ease}" },
      0
    );${hasFg ? `
    // Parallax fg — counter-direction pan, half the distance
    tl.fromTo(".fg-img",
      { x: ${(-fromX * 0.5).toFixed(1)}, y: ${(-fromY * 0.5).toFixed(1)}, scale: 1.03 },
      { x: 0, y: 0, duration: ${dur.toFixed(2)}, ease: "${ease}" },
      0
    );` : ""}`;
  }
  return "";
}

/** Build a CSS overlay div for scene.focus (vignette / spotlight). */
function buildFocusOverlay(scene: Scene): { css: string; html: string } {
  const f = scene.focus;
  if (!f) return { css: "", html: "" };
  const x = ((f.x ?? 0.5) * 100).toFixed(1);
  const y = ((f.y ?? 0.5) * 100).toFixed(1);
  const r = ((f.radius ?? 0.4) * 100).toFixed(1);
  const dim = (f.dim ?? 0.35).toFixed(2);
  if (f.kind === "vignette") {
    return {
      css: `.focus-overlay { position: absolute; inset: 0; background: radial-gradient(ellipse at ${x}% ${y}%, rgba(0,0,0,0) ${(parseFloat(r) - 5).toFixed(0)}%, rgba(0,0,0,${dim}) 100%); pointer-events: none; z-index: 1; }`,
      html: `<div class="focus-overlay" data-layout-ignore></div>`,
    };
  }
  if (f.kind === "spotlight") {
    return {
      css: `.focus-overlay { position: absolute; inset: 0; background: radial-gradient(circle at ${x}% ${y}%, rgba(0,0,0,0) ${(parseFloat(r) * 0.6).toFixed(0)}%, rgba(0,0,0,${dim}) ${r}%, rgba(0,0,0,${(parseFloat(dim) + 0.2).toFixed(2)}) 100%); pointer-events: none; z-index: 1; }`,
      html: `<div class="focus-overlay" data-layout-ignore></div>`,
    };
  }
  if (f.kind === "dof") {
    return {
      css: `.focus-overlay { position: absolute; inset: 0; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); mask: radial-gradient(circle at ${x}% ${y}%, transparent ${(parseFloat(r) * 0.7).toFixed(0)}%, black ${r}%); -webkit-mask: radial-gradient(circle at ${x}% ${y}%, transparent ${(parseFloat(r) * 0.7).toFixed(0)}%, black ${r}%); pointer-events: none; z-index: 1; }`,
      html: `<div class="focus-overlay" data-layout-ignore></div>`,
    };
  }
  return { css: "", html: "" };
}

/** Resolve foreground (matted PNG) — full absolute path or null. */
function pickForeground(scene: Scene): { rel: string; absPath: string } | null {
  if (!scene.foreground) return null;
  const abs = path.resolve(process.cwd(), "assets", scene.foreground);
  if (!fs.existsSync(abs)) return null;
  return { rel: scene.foreground, absPath: abs };
}

export interface RenderContext {
  width: number;
  height: number;
  fps: number;
  /** Project root, used to resolve asset paths */
  projectRoot: string;
  /** Resolved style tokens for THIS scene (project preset + per-scene override). */
  design: ResolvedDesign;
}

export type RenderOutput =
  | {
      engine: "hyperframes";
      /** Full HTML composition source */
      html: string;
      /** Files (relative path → source path) to copy alongside the html (assets, layer pngs, etc.) */
      sideFiles?: Record<string, string>;
    }
  | {
      engine: "remotion";
      /** Composition TSX source (will be placed as src/Composition.tsx) */
      tsx: string;
      /** Composition id matching the Composition component */
      compId: string;
      /** Props to pass via `--props='{...}'` to remotion render */
      props: Record<string, unknown>;
      /** Files to copy under the scene dir. Use "public/X" to make staticFile("X") work. */
      sideFiles?: Record<string, string>;
    };

export type MethodRenderer = (scene: Scene, ctx: RenderContext) => RenderOutput;

// ──────────────────────────────────────────────────────────────────────────
// hf-css-fade — universal fallback. Always safe.
// ──────────────────────────────────────────────────────────────────────────
const hfCssFade: MethodRenderer = (scene, ctx) => {
  const lines = scene.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const safeLines = lines
    .map(
      (l, i) =>
        `<div class="line line-${i}">${escapeHtml(l)}</div>`
    )
    .join("\n      ");
  const bgImage = pickGeneratedBg(scene);
  const fg = pickForeground(scene);
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
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: #f6f5f1; color: #1b1612; font-family: "Noto Serif SC", "Songti SC", "PingFang SC", serif; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; padding: 0 130px; gap: 16px; }
  .bg { position: absolute; inset: 0; background: #f6f5f1; }
  .kicker { position: absolute; left: 130px; top: ${Math.round(ctx.height * 0.16)}px; display: flex; align-items: center; gap: 16px; font-family: "Noto Sans SC", -apple-system, sans-serif; font-size: ${Math.round(ctx.height * 0.017)}px; font-weight: 700; letter-spacing: 0.26em; color: #9e5326; }
  .kicker .bar { display: inline-block; width: 52px; height: 3px; background: #c36c36; transform-origin: 0 50%; }
  ${bgImage ? `.bg-img { position: absolute; inset: 0; background-image: url('bg.png'); background-size: cover; background-position: center; opacity: 0.55; filter: saturate(0.85) brightness(0.7); will-change: transform; } .bg-veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5,3,8,0.4) 0%, rgba(5,3,8,0.78) 100%); z-index: 1; }` : ""}
  ${fg ? `.fg-img { position: absolute; left: 12%; top: 18%; width: 56%; height: 64%; background-image: url('fg.png'); background-size: contain; background-repeat: no-repeat; background-position: center; z-index: 2; filter: drop-shadow(0 20px 40px rgba(0,0,0,0.5)); }` : ""}
  ${focusOverlay.css}
  .line { position: relative; font-size: 62px; font-weight: 600; line-height: 1.55; letter-spacing: 0.01em; text-align: left; color: #1b1612; opacity: 0; max-width: ${ctx.width - 260}px; z-index: 3; }
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

// ──────────────────────────────────────────────────────────────────────────
// hf-kinetic-text — GSAP kinetic text for short hero phrases
// ──────────────────────────────────────────────────────────────────────────
const hfKineticText: MethodRenderer = (scene, ctx) => {
  const segments = (scene.text.replace(/\s+/g, " ").trim().match(/[A-Za-z0-9]+|[一-鿿]|[^\sA-Za-z0-9]/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s && !/^[，。、！？；：·,.]$/.test(s));

  const wordEls = segments
    .map((seg, i) => `<span class="w" data-i="${i}">${escapeHtml(seg)}</span>`)
    .join("\n      ");
  const bgImage = pickGeneratedBg(scene);
  const fg = pickForeground(scene);
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
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: #f6f5f1; color: #1b1612; font-family: "Noto Serif SC", "Songti SC", "PingFang SC", serif; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; display: flex; align-items: center; justify-content: center; }
  .bg { position: absolute; inset: 0; background: #f6f5f1; }
  ${bgImage ? `.bg-img { position: absolute; inset: 0; background-image: url('bg.png'); background-size: cover; background-position: center; opacity: 0.92; filter: saturate(1.0) brightness(0.92) contrast(1.05); will-change: transform; } .bg-veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 60%, rgba(0,0,0,0.0) 30%, rgba(5,3,8,0.55) 95%); z-index: 1; }` : ""}
  ${fg ? `.fg-img { position: absolute; left: 60%; top: 12%; width: 36%; height: 76%; background-image: url('fg.png'); background-size: contain; background-repeat: no-repeat; background-position: center; z-index: 2; filter: drop-shadow(0 24px 48px rgba(0,0,0,0.6)); }` : ""}
  ${focusOverlay.css}
  .stage { display: flex; flex-wrap: wrap; gap: 8px 4px; padding: 0 120px; justify-content: center; max-width: ${ctx.width - 200}px; position: relative; z-index: 3; }
  .w { font-size: 110px; font-weight: 700; letter-spacing: 0.02em; line-height: 1.14; opacity: 0; transform-origin: 50% 100%; color: #1b1612; }
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

// ──────────────────────────────────────────────────────────────────────────
// rm-d3-bar-chart — Remotion + D3 scale, animated bar chart
// ──────────────────────────────────────────────────────────────────────────
const rmD3BarChart: MethodRenderer = (scene, ctx) => {
  // Prefer real data from `pipeline research` (scene.data.items); fall back to a
  // generic 5-bar sample so the scene still renders even when no research was run.
  const items = scene.data?.items?.length
    ? scene.data.items.slice(0, 7).map((it) => ({ label: String(it.label), value: Number(it.value) }))
    : [
        { label: "A", value: 30 },
        { label: "B", value: 45 },
        { label: "C", value: 22 },
        { label: "D", value: 38 },
        { label: "E", value: 51 },
      ];

  return {
    engine: "remotion",
    compId: "Scene",
    props: {
      title: scene.text,
      data: items,
      durationSec: scene.durationSec,
    },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing, spring } from "remotion";
import { scaleLinear, scaleBand, max } from "d3";

type Item = { label: string; value: number };
type Props = { title: string; data: Item[]; durationSec: number };

export const Scene: React.FC<Props> = ({ title, data }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const marginTop = 200;
  const marginBottom = 100;
  const marginX = 120;
  const chartW = width - marginX * 2;
  const chartH = height - marginTop - marginBottom;

  const yMax = max(data, (d) => d.value) ?? 1;
  const x = scaleBand<string>().domain(data.map((d) => d.label)).range([0, chartW]).padding(0.32);
  const y = scaleLinear().domain([0, yMax * 1.1]).range([chartH, 0]);

  const titleOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [0, 18], [22, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  return (
    <AbsoluteFill style={{
      background: "${ctx.design.paper}",
      color: "${ctx.design.ink}",
      fontFamily: "-apple-system, 'PingFang SC', 'Source Han Sans SC', sans-serif",
    }}>
      <div style={{
        position: "absolute", left: marginX, top: 70,
        fontSize: 56, fontWeight: 500, letterSpacing: "0.04em",
        opacity: titleOpacity, transform: \`translateY(\${titleY}px)\`,
      }}>{title}</div>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <g transform={\`translate(\${marginX},\${marginTop})\`}>
          {data.map((d, i) => {
            const startFrame = 20 + i * 6;
            const progress = interpolate(frame, [startFrame, startFrame + 26], [0, 1], {
              extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
            });
            const barH = (chartH - y(d.value)) * progress;
            const barY = chartH - barH;
            const landScale = spring({ frame: frame - (startFrame + 24), fps, config: { damping: 12, stiffness: 200 }, durationInFrames: 18 });
            return (
              <g key={d.label} transform={\`translate(\${x(d.label)},0)\`}>
                <rect x={0} y={barY} width={x.bandwidth()} height={barH} rx={4}
                  fill={d.value === yMax ? "${ctx.design.accent}" : "${ctx.design.accent2}"}
                  style={{ transformOrigin: \`50% \${chartH}px\`, transform: \`scaleY(\${landScale < 1 ? 1 + (1 - landScale) * 0.05 : 1})\` }}
                />
                <text x={x.bandwidth() / 2} y={barY - 14} textAnchor="middle" fill={d.value === yMax ? "${ctx.design.accent}" : "${ctx.design.ink}"} fontSize="36" fontWeight="500" opacity={progress} fontFamily="-apple-system, ui-monospace, monospace">
                  {(d.value * progress).toFixed(1)}
                </text>
                <text x={x.bandwidth() / 2} y={chartH + 40} textAnchor="middle" fill="${ctx.design.muted}" fontSize="22" letterSpacing="0.12em" opacity={progress}>
                  {d.label}
                </text>
              </g>
            );
          })}
        </g>
        <defs>
          <linearGradient id="gradBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4a64a" />
            <stop offset="100%" stopColor="#78461e" />
          </linearGradient>
          <linearGradient id="gradPeak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f4d479" />
            <stop offset="100%" stopColor="#b87f1f" />
          </linearGradient>
        </defs>
      </svg>
    </AbsoluteFill>
  );
};
`,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// hf-anime-scatter — list items fly in with stagger (Anime.js)
// ──────────────────────────────────────────────────────────────────────────
const hfAnimeScatter: MethodRenderer = (scene, ctx) => {
  const items = scene.text
    .split(/[、,,·\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tiles = items
    .map((s, i) => `<div class="tile" data-i="${i}">${escapeHtml(s)}</div>`)
    .join("\n      ");
  const bgImage = pickGeneratedBg(scene);
  const fg = pickForeground(scene);
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
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: #f6f5f1; color: #1b1612; font-family: "Noto Serif SC", "Songti SC", "PingFang SC", serif; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; display: flex; align-items: center; justify-content: center; }
  .bg { position: absolute; inset: 0; background: #f6f5f1; }
  ${bgImage ? `.bg-img { position: absolute; inset: 0; background-image: url('bg.png'); background-size: cover; background-position: center; opacity: 0.45; filter: saturate(0.7) brightness(0.6); will-change: transform; } .bg-veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 30% 70%, rgba(0,0,0,0.15) 0%, rgba(5,3,8,0.78) 75%); z-index: 1; }` : ""}
  ${fg ? `.fg-img { position: absolute; left: 70%; top: 14%; width: 26%; height: 72%; background-image: url('fg.png'); background-size: contain; background-repeat: no-repeat; background-position: center; z-index: 2; filter: drop-shadow(0 18px 38px rgba(0,0,0,0.5)); }` : ""}
  ${focusOverlay.css}
  .grid { display: flex; flex-wrap: wrap; gap: 18px 22px; padding: 0 140px; justify-content: center; max-width: ${ctx.width - 200}px; position: relative; z-index: 3; }
  .tile {
    padding: 16px 30px; font-size: 44px; font-weight: 600; letter-spacing: 0.02em;
    background: #ffffff; color: #1b1612;
    border: 1px solid rgba(27,22,18,0.14);
    border-left: 3px solid #c36c36;
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

// ──────────────────────────────────────────────────────────────────────────
// hf-waapi-marker — highlight a phrase with a gold marker sweep
// ──────────────────────────────────────────────────────────────────────────
const hfWaapiMarker: MethodRenderer = (scene, ctx) => {
  const bgImage = pickGeneratedBg(scene);
  const fg = pickForeground(scene);
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
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: #f6f5f1; color: #1b1612; font-family: "Noto Serif SC", "Songti SC", "PingFang SC", serif; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; display: flex; align-items: center; justify-content: center; }
  .bg { position: absolute; inset: 0; background: #f6f5f1; }
  ${bgImage ? `.bg-img { position: absolute; inset: 0; background-image: url('bg.png'); background-size: cover; background-position: center; opacity: 0.45; filter: saturate(0.8) brightness(0.55); will-change: transform; } .bg-veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0.1) 0%, rgba(5,3,8,0.82) 70%); z-index: 1; }` : ""}
  ${fg ? `.fg-img { position: absolute; left: 16%; top: 10%; width: 28%; height: 80%; background-image: url('fg.png'); background-size: contain; background-repeat: no-repeat; background-position: center; z-index: 2; filter: drop-shadow(0 22px 44px rgba(0,0,0,0.6)); }` : ""}
  ${focusOverlay.css}
  .phrase {
    position: relative; padding: 12px 18px;
    font-size: 86px; font-weight: 700; letter-spacing: 0.02em;
    color: #1b1612; line-height: 1.28;
    max-width: ${ctx.width - 240}px; text-align: center;
    opacity: 0;
    z-index: 3;
  }
  .marker {
    position: absolute; left: 0; bottom: 12px;
    height: 26px; width: 0%;
    background: rgba(195,108,54,0.30);
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

// ──────────────────────────────────────────────────────────────────────────
// rm-d3-line-trend — D3 timeseries line chart (Remotion)
// ──────────────────────────────────────────────────────────────────────────
const rmD3LineTrend: MethodRenderer = (scene, ctx) => {
  const PALETTE = [ctx.design.accent, ctx.design.ink, ctx.design.accent2, ctx.design.muted, "#3f8f5e", "#c9a05e"];
  const real = scene.data?.years && scene.data.series;
  const data = real
    ? {
        years: scene.data!.years!.map(String),
        series: scene.data!.series!.map((s, i) => ({
          name: String(s.name),
          color: s.color || PALETTE[i % PALETTE.length],
          values: s.values.map(Number),
        })),
      }
    : {
        years: ["2018", "2019", "2020", "2021", "2022", "2023", "2024"],
        series: [
          { name: "GSAP",    color: "#f4d479", values: [1.0, 1.2, 1.4, 1.6, 1.9, 2.2, 2.5] },
          { name: "Anime.js", color: "#d4a64a", values: [0.20, 0.30, 0.40, 0.50, 0.60, 0.65, 0.70] },
          { name: "Framer",   color: "#9b6cff", values: [0.05, 0.10, 0.20, 0.40, 0.60, 0.80, 0.95] },
          { name: "Lottie",   color: "#5fc4f4", values: [0.15, 0.20, 0.25, 0.28, 0.30, 0.32, 0.33] },
        ],
      };
  return {
    engine: "remotion",
    compId: "Scene",
    props: { title: scene.text, data, durationSec: scene.durationSec },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { scaleLinear, scalePoint, line as d3line, max } from "d3";

type Series = { name: string; color: string; values: number[] };
type Data = { years: string[]; series: Series[] };
type Props = { title: string; data: Data; durationSec: number };

export const Scene: React.FC<Props> = ({ title, data }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const marginTop = 200, marginBottom = 100, marginX = 140;
  const chartW = width - marginX * 2;
  const chartH = height - marginTop - marginBottom;

  const x = scalePoint<string>().domain(data.years).range([0, chartW]).padding(0.1);
  const yMax = max(data.series.flatMap((s) => s.values)) ?? 1;
  const y = scaleLinear().domain([0, yMax * 1.1]).range([chartH, 0]);

  const titleOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [0, 18], [22, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  // Draw lines: each series animates its path stroke-dashoffset from full to 0
  return (
    <AbsoluteFill style={{
      background: "${ctx.design.paper}",
      color: "${ctx.design.ink}",
      fontFamily: "-apple-system, 'PingFang SC', sans-serif",
    }}>
      <div style={{
        position: "absolute", left: marginX, top: 70,
        fontSize: 56, fontWeight: 500, letterSpacing: "0.04em",
        opacity: titleOpacity, transform: \`translateY(\${titleY}px)\`,
      }}>{title}</div>

      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {/* Y gridlines */}
        {y.ticks(4).map((tick) => (
          <g key={tick} transform={\`translate(\${marginX},\${marginTop + y(tick)})\`}>
            <line x2={chartW} stroke="${ctx.design.line}" strokeDasharray="6 8" />
            <text x={-16} y={6} fill="${ctx.design.muted}" fontSize={18} textAnchor="end" fontVariantNumeric="tabular-nums">
              {tick.toFixed(1)}M
            </text>
          </g>
        ))}
        {/* X labels */}
        {data.years.map((yr) => (
          <text key={yr} x={marginX + (x(yr) ?? 0)} y={marginTop + chartH + 36}
            fill="${ctx.design.muted}" fontSize={20} textAnchor="middle" letterSpacing="0.12em">{yr}</text>
        ))}

        <g transform={\`translate(\${marginX},\${marginTop})\`}>
          {data.series.map((s, si) => {
            const startFrame = 18 + si * 6;
            const drawProgress = interpolate(frame, [startFrame, startFrame + 40], [0, 1], {
              extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
            });
            // Build path
            const lineGen = d3line<{ year: string; v: number }>()
              .x((d) => x(d.year) ?? 0)
              .y((d) => y(d.v));
            const path = lineGen(s.values.map((v, i) => ({ year: data.years[i], v }))) ?? "";

            // For dash animation we'd need path length, but we can approximate by using x-clip
            const clipX = chartW * drawProgress;

            return (
              <g key={s.name}>
                <defs>
                  <clipPath id={\`clip-\${si}\`}>
                    <rect x={0} y={0} width={clipX} height={chartH} />
                  </clipPath>
                </defs>
                <path d={path} fill="none" stroke={s.color} strokeWidth={4} strokeLinecap="round"
                      clipPath={\`url(#clip-\${si})\`} />
                {/* End-cap dot at current line tip */}
                {s.values.map((v, i) => {
                  const px = x(data.years[i]) ?? 0;
                  if (px > clipX) return null;
                  const dotOp = interpolate(frame, [startFrame + i * 4, startFrame + i * 4 + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                  return <circle key={i} cx={px} cy={y(v)} r={4} fill={s.color} opacity={dotOp} />;
                })}
                {/* Legend label (series name at right edge) */}
                {drawProgress > 0.7 && (
                  <text x={chartW + 16} y={y(s.values.at(-1)!) + 6} fill={s.color} fontSize={22} fontWeight={500} opacity={(drawProgress - 0.7) / 0.3}>
                    {s.name}
                  </text>
                )}
              </g>
            );
          })}
          {/* Baseline axis */}
          <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke="${ctx.design.line}" />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
`,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// rm-framer-card-stack — Framer Motion spring cards (Remotion)
// ──────────────────────────────────────────────────────────────────────────
const rmFramerCardStack: MethodRenderer = (scene, ctx) => {
  // Parse "title：A、B、C" or just "A、B、C"
  const text = scene.text;
  const colonMatch = text.match(/^(.+?)[：:]\s*(.+)$/);
  const heading = colonMatch ? colonMatch[1].trim() : "";
  const itemsRaw = (colonMatch ? colonMatch[2] : text)
    .split(/[、,，·]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items = itemsRaw.length ? itemsRaw : [text];

  return {
    engine: "remotion",
    compId: "Scene",
    props: { heading, items, durationSec: scene.durationSec },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";

type Props = { heading: string; items: string[]; durationSec: number };

export const Scene: React.FC<Props> = ({ heading, items }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const headOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const headY = interpolate(frame, [0, 18], [22, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  const cardCount = items.length;
  const cardW = Math.min(380, (width - 240 - (cardCount - 1) * 32) / cardCount);
  const cardH = 360;
  const gap = 32;
  const totalW = cardCount * cardW + (cardCount - 1) * gap;
  const startX = (width - totalW) / 2;
  const cardY = (height - cardH) / 2 + 60;

  return (
    <AbsoluteFill style={{
      background: "${ctx.design.paper}",
      color: "${ctx.design.ink}",
      fontFamily: "-apple-system, 'PingFang SC', sans-serif",
    }}>
      {heading && (
        <div style={{
          position: "absolute", left: 0, right: 0, top: 90, textAlign: "center",
          fontSize: 52, fontWeight: 500, letterSpacing: "0.04em",
          opacity: headOpacity, transform: \`translateY(\${headY}px)\`,
        }}>
          {heading}
        </div>
      )}

      {items.map((label, i) => {
        const startFrame = 8 + i * 7;
        const s = spring({
          frame: frame - startFrame, fps,
          config: { damping: 14, stiffness: 180, mass: 0.6 },
          durationInFrames: 38,
        });
        const op = interpolate(frame, [startFrame, startFrame + 8], [0, 1], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp",
        });
        const y = (1 - s) * 80;
        const rot = (1 - s) * (i % 2 === 0 ? -8 : 8);
        const x = startX + i * (cardW + gap);
        const isMiddle = cardCount >= 3 && i === Math.floor(cardCount / 2);

        return (
          <div key={i} style={{
            position: "absolute",
            left: x, top: cardY + y,
            width: cardW, height: cardH,
            transform: \`rotate(\${rot}deg) scale(\${0.85 + s * 0.15})\`,
            opacity: op,
            borderRadius: 16,
            background: "${ctx.design.pw}",
            border: \`1px solid ${ctx.design.line}\`,
            borderLeft: \`4px solid \${isMiddle ? "${ctx.design.accent}" : "${ctx.design.accent2}"}\`,
            boxShadow: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
          }}>
            <div style={{
              fontSize: 22, color: isMiddle ? "${ctx.design.accent}" : "${ctx.design.muted}",
              letterSpacing: "0.32em",
            }}>· {String(i + 1).padStart(2, "0")} ·</div>
            <div style={{
              fontSize: 80, fontWeight: 600, letterSpacing: "0.06em",
              color: isMiddle ? "${ctx.design.accent}" : "${ctx.design.ink}",
            }}>{label}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
`,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// rm-image-kenburns — Remotion, single image + non-linear pan/zoom
// ──────────────────────────────────────────────────────────────────────────
const rmImageKenburns: MethodRenderer = (scene, ctx) => {
  // First image-like asset (any path, not just generated/) is the subject.
  const imgAsset = (scene.assets ?? []).find((a) => /\.(jpg|jpeg|png|webp)$/i.test(a));
  if (!imgAsset) {
    // Fall back to css-fade if no image — keeps the pipeline producing.
    return hfCssFade(scene, ctx);
  }
  const absPath = path.resolve(process.cwd(), "assets", imgAsset);
  const fileName = path.basename(absPath);
  // Pick a kenburns spec from scene.motion (analyzer-set); fall back to mild in-zoom.
  const m = scene.motion ?? { kind: "kenburns", direction: "in", intensity: "subtle", ease: "power3.inOut" };
  const intensity = m.intensity === "strong" ? 0.22 : m.intensity === "medium" ? 0.14 : 0.06;
  const startScale = m.direction === "out" ? 1 + intensity : 1;
  const endScale = m.direction === "out" ? 1 : 1 + intensity;
  const fromX = m.direction === "left" ? intensity * 8 : m.direction === "right" ? -intensity * 8 : 0;
  const toX = m.direction === "left" ? -intensity * 8 : m.direction === "right" ? intensity * 8 : 0;

  return {
    engine: "remotion",
    compId: "Scene",
    props: {
      title: scene.text,
      durationSec: scene.durationSec,
      startScale, endScale, fromX, toX,
      ease: m.ease ?? "easeInOutCubic",
    },
    sideFiles: { [`public/${fileName}`]: absPath },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing, staticFile } from "remotion";

type Props = {
  title: string; durationSec: number;
  startScale: number; endScale: number; fromX: number; toX: number; ease: string;
};

// Map analyzer ease names → Remotion Easing.
const EASE_MAP: Record<string, any> = {
  "power3.inOut": Easing.inOut(Easing.cubic),
  "power2.inOut": Easing.inOut(Easing.quad),
  "expo.inOut":   Easing.inOut(Easing.exp),
  "sine.inOut":   Easing.inOut(Easing.sin),
};

export const Scene: React.FC<Props> = ({ title, startScale, endScale, fromX, toX, ease }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const easing = EASE_MAP[ease] ?? Easing.inOut(Easing.cubic);
  const t = frame / Math.max(1, durationInFrames - 1);
  const scale = interpolate(t, [0, 1], [startScale, endScale], { easing });
  const xPct  = interpolate(t, [0, 1], [fromX, toX], { easing });
  const titleOpacity = interpolate(frame, [6, 22], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [6, 28], [22, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ background: "#050308", overflow: "hidden", fontFamily: "-apple-system, 'PingFang SC', sans-serif" }}>
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: \`url(\${staticFile("${fileName}")})\`,
        backgroundSize: "cover", backgroundPosition: \`\${50 + xPct}% 50%\`,
        transform: \`scale(\${scale})\`, transformOrigin: "50% 50%",
        filter: "saturate(0.92) brightness(0.85)",
      }} />
      <AbsoluteFill style={{
        background: "linear-gradient(180deg, rgba(5,3,8,0.25) 0%, rgba(5,3,8,0.7) 100%)",
      }} />
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: "12%",
        textAlign: "center", fontSize: 64, fontWeight: 500, letterSpacing: "0.04em",
        color: "${ctx.design.ink}", textShadow: "0 4px 22px rgba(0,0,0,0.7)",
        opacity: titleOpacity, transform: \`translateY(\${titleY}px)\`,
        padding: "0 120px",
      }}>{title}</div>
    </AbsoluteFill>
  );
};
`,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// rm-video-clip — Remotion passthrough of a local mp4 with light grade
// ──────────────────────────────────────────────────────────────────────────
const rmVideoClip: MethodRenderer = (scene, ctx) => {
  const videoAsset = (scene.assets ?? []).find((a) => /\.(mp4|mov|webm)$/i.test(a));
  if (!videoAsset) return hfCssFade(scene, ctx);
  const absPath = path.resolve(process.cwd(), "assets", videoAsset);
  const fileName = path.basename(absPath);
  return {
    engine: "remotion",
    compId: "Scene",
    props: { title: scene.text, durationSec: scene.durationSec },
    sideFiles: { [`public/${fileName}`]: absPath },
    tsx: `import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, interpolate, Easing } from "remotion";

type Props = { title: string; durationSec: number };

export const Scene: React.FC<Props> = ({ title }) => {
  const frame = useCurrentFrame();
  const titleOpacity = interpolate(frame, [4, 22], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden", fontFamily: "-apple-system, 'PingFang SC', sans-serif" }}>
      <OffthreadVideo src={staticFile("${fileName}")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.55) 100%)" }} />
      <div style={{
        position: "absolute", left: 80, bottom: 70, maxWidth: "70%",
        fontSize: 48, fontWeight: 500, color: "#f4ead0", letterSpacing: "0.02em",
        textShadow: "0 4px 22px rgba(0,0,0,0.7)", opacity: titleOpacity,
      }}>{title}</div>
    </AbsoluteFill>
  );
};
`,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// hf-lottie-play — HyperFrames + lottie-web for a .lottie or .json animation
// ──────────────────────────────────────────────────────────────────────────
const hfLottiePlay: MethodRenderer = (scene, ctx) => {
  const lottieAsset = (scene.assets ?? []).find((a) => /\.(lottie|json)$/i.test(a));
  if (!lottieAsset) return hfCssFade(scene, ctx);
  const absPath = path.resolve(process.cwd(), "assets", lottieAsset);
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

// ──────────────────────────────────────────────────────────────────────────
// hf-tailwind-card — HyperFrames + Tailwind, product/feature tile
// ──────────────────────────────────────────────────────────────────────────
const hfTailwindCard: MethodRenderer = (scene, ctx) => {
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
const hfPosterHero: MethodRenderer = (scene, ctx) => {
  const bgImage = pickGeneratedBg(scene);
  if (!bgImage) return hfKineticText(scene, ctx);

  const m = scene.motion ?? { kind: "kenburns", direction: "in", intensity: "subtle", ease: "power3.inOut" };
  const intensity = m.intensity === "strong" ? 0.18 : m.intensity === "medium" ? 0.10 : 0.05;
  const startScale = m.direction === "out" ? 1 + intensity : 1;
  const endScale   = m.direction === "out" ? 1 : 1 + intensity;
  const ease = m.ease || "power3.inOut";

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
  <div class="stamp" id="stamp">山海 · MMXXVI · IMG ${String(scene.index).padStart(3, "0")}</div>

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

// ──────────────────────────────────────────────────────────────────────────
// hf-mountain-reveal — cinematic title that rises FROM BEHIND a matted
// mountain. The same plate is used twice: once as the full background, once
// (matted, transparent sky) as a pixel-registered foreground occluder. The
// title sits BETWEEN them, so as it translates up it is precisely hidden by
// the mountain silhouette and emerges through the notches beside the peak.
// Requires scene.foreground (a matte of the bg). Falls back to poster-hero.
// ──────────────────────────────────────────────────────────────────────────
const hfMountainReveal: MethodRenderer = (scene, ctx) => {
  const bgImage = pickGeneratedBg(scene);
  const fg = pickForeground(scene);
  // Needs both the full plate AND a matte of it to do the occlusion trick.
  if (!bgImage || !fg) return hfPosterHero(scene, ctx);

  const dur = scene.durationSec;
  const m = scene.motion ?? { kind: "kenburns", direction: "in", intensity: "subtle", ease: "power2.inOut" };
  const kb = m.intensity === "strong" ? 0.12 : m.intensity === "medium" ? 0.08 : 0.055;
  const kbStart = m.direction === "out" ? 1 + kb : 1;
  const kbEnd   = m.direction === "out" ? 1 : 1 + kb;
  const ease = m.ease || "power2.inOut";

  const caption  = scene.notes?.[0] ?? "山海行记 · CHAPTER 01";
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
  /* Layer 1 — volumetric glow behind the peak (screen-blended) */
  .glow {
    position: absolute; left: 50%; top: 30%;
    width: 70%; height: 55%;
    transform: translate(-50%, -50%);
    background: radial-gradient(ellipse at center, rgba(255,196,110,0.55) 0%, rgba(255,170,90,0.20) 35%, rgba(255,170,90,0) 70%);
    mix-blend-mode: screen; z-index: 1; opacity: 0.55;
    will-change: opacity, transform;
  }
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
  <div class="glow" id="glow" data-layout-ignore></div>
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
  <div class="stamp" id="stamp" data-layout-ignore>山海 · MMXXVI · NO.${String(scene.index).padStart(3, "0")}</div>

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

    // Glow swells as the title clears the peak (the cinematic punctuation).
    tl.fromTo("#glow", { opacity: 0.32, scale: 0.92 },
      { opacity: 0.85, scale: 1.06, duration: ${(dRise * 0.9).toFixed(2)}, ease: "power2.out" }, ${(tRise + dRise * 0.25).toFixed(2)});
    tl.to("#glow", { opacity: 0.6, duration: ${Math.max(0.6, dur - tRise - dRise).toFixed(2)}, ease: "sine.inOut" }, ">");

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

// ──────────────────────────────────────────────────────────────────────────
// hf-line-reveal — clean LIGHT infographic: a white titled card with a
// multi-series line chart whose lines draw on left-to-right (snappy), with
// markers popping in along the draw front. Reverse-engineered from a
// Bilibili explainer's "亚洲各国GDP增速" data card. Data-driven via
// scene.data { years, series:[{name,color,values}] }.
// ──────────────────────────────────────────────────────────────────────────
const hfLineReveal: MethodRenderer = (scene, ctx) => {
  const W = ctx.width, H = ctx.height;
  const PALETTE = [ctx.design.accent, "#1b1612", "#8a8174", ctx.design.accent2, "#3f8f5e"];
  const hasData = scene.data?.years && scene.data?.series;
  const years: string[] = hasData
    ? scene.data!.years!.map(String)
    : ["1990", "1991", "1992", "1993", "1994", "1995", "1996", "1997", "1998"];
  const series = hasData
    ? scene.data!.series!.map((s, i) => ({
        name: String(s.name),
        color: s.color || PALETTE[i % PALETTE.length],
        values: s.values.map(Number),
      }))
    : [
        { name: "泰国",       color: PALETTE[0], values: [11.0, 8.0, 8.0, 8.5, 9.0, 9.2, 9.0, 8.6, 9.0] },
        { name: "印度尼西亚", color: PALETTE[1], values: [9.0, 8.9, 7.2, 7.3, 7.5, 8.2, 7.8, 8.0, 8.3] },
        { name: "马来西亚",   color: PALETTE[2], values: [9.0, 9.5, 8.9, 9.9, 9.2, 9.8, 10.0, 9.6, 10.2] },
        { name: "韩国",       color: PALETTE[3], values: [9.8, 9.4, 5.9, 6.1, 8.5, 9.2, 8.8, 9.0, 9.4] },
        { name: "菲律宾",     color: PALETTE[4], values: [3.0, 0.5, 0.3, 2.1, 4.4, 4.7, 5.8, 5.5, 6.0] },
      ];

  const title = scene.text || "亚洲各国GDP增速";
  const subtitle = (scene.notes && scene.notes[0]) || `GDP GROWTH RATE · ${years[0]}–${years[years.length - 1]}`;

  // ── Geometry (computed in TS, baked into SVG) ──────────────────────────
  const n = years.length;
  const px0 = 250, px1 = W - 200, plotW = px1 - px0;
  const py0 = 360, py1 = H - 190, plotH = py1 - py0;
  const allV = series.flatMap((s) => s.values);
  const yMin = Math.min(0, Math.floor(Math.min(...allV)));
  const yMax = Math.ceil(Math.max(...allV) / 2) * 2 + 1;
  const X = (i: number) => px0 + (i * plotW) / (n - 1);
  const Y = (v: number) => py1 - ((v - yMin) / (yMax - yMin)) * plotH;

  const gridVals: number[] = [];
  for (let g = yMin; g <= yMax; g += 5) gridVals.push(g);

  const paths = series
    .map((s, si) => {
      const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
      return `<path class="ln ln-${si}" d="${d}" fill="none" stroke="${s.color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join("\n      ");
  const markers = series
    .map((s, si) =>
      s.values
        .map(
          (v, i) =>
            `<circle class="mk mk-${si}" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="6" fill="#fff" stroke="${s.color}" stroke-width="3" />`
        )
        .join("")
    )
    .join("\n      ");
  const grid = gridVals
    .map(
      (g) =>
        `<line x1="${px0}" x2="${px1}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}" stroke="${g === 0 ? "#c9ced8" : "#e6e9ef"}" stroke-width="${g === 0 ? 2 : 1}" stroke-dasharray="${g === 0 ? "0" : "2 7"}" /><text x="${px0 - 22}" y="${(Y(g) + 6).toFixed(1)}" fill="#9aa1ad" font-size="22" text-anchor="end" font-weight="600">${g}%</text>`
    )
    .join("\n      ");
  const xlabels = years
    .map(
      (yr, i) =>
        `<text x="${X(i).toFixed(1)}" y="${py1 + 44}" fill="#9aa1ad" font-size="22" text-anchor="middle" font-weight="600">'${yr.slice(2)}</text>`
    )
    .join("\n      ");
  const legend = series
    .map(
      (s) =>
        `<span class="chip"><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`
    )
    .join("");

  const dur = scene.durationSec;
  const drawAt = 0.35, drawDur = Math.min(0.62, dur * 0.42);

  return {
    engine: "hyperframes",
    html: `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@500;700;900&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${ctx.design.paper}; font-family: ${ctx.design.sans}; }
  #root { position: relative; width: ${W}px; height: ${H}px; }
  /* Dark backdrop with a faded sepia b-roll bleed on the far left (mirrors ref framing) */
  .backdrop { position: absolute; inset: 0; background: ${ctx.design.paper}; }
  .card {
    position: absolute; left: 70px; top: 56px; width: ${W - 140}px; height: ${H - 112}px;
    background: #ffffff; border-radius: 18px;
    border: 1px solid ${ctx.design.line};
    overflow: hidden;
  }
  .titleblk { position: absolute; left: 0; right: 0; top: 70px; text-align: center; }
  .t-hl { position: relative; display: inline-block; padding: 6px 22px; }
  .t-hl .bar {
    position: absolute; left: 0; right: 0; bottom: 8px; height: 26px;
    background: color-mix(in srgb, ${ctx.design.accent} 22%, transparent); border-radius: 4px; z-index: 0;
    transform: scaleX(0); transform-origin: 0 50%;
  }
  .t-hl span.tx { position: relative; z-index: 1; font-size: 60px; font-weight: 700; color: #1b1612; letter-spacing: 0.02em; }
  .t-sub { margin-top: 12px; font-size: 22px; font-weight: 600; letter-spacing: 0.34em; color: #9aa1ad; }
  .legend { position: absolute; left: 0; right: 0; top: 232px; text-align: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 10px;
    margin: 0 9px; padding: 9px 20px; border-radius: 999px;
    background: #f3f5f8; color: #3a414e; font-size: 24px; font-weight: 700;
    opacity: 0; transform: translateY(8px);
  }
  .chip i { width: 16px; height: 16px; border-radius: 50%; display: inline-block; }
  svg { position: absolute; inset: 0; }
  .ln { filter: drop-shadow(0 3px 5px rgba(0,0,0,0.06)); }
  .mk { opacity: 0; }
  .gridg, .xlab { opacity: 0; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${dur}" data-width="${W}" data-height="${H}">
  <div class="backdrop" data-layout-ignore></div>
  <div class="card" id="card" data-layout-ignore>
    <div class="titleblk" id="tblk">
      <div class="t-hl" id="thl"><i class="bar" id="hlbar"></i><span class="tx">${escapeHtml(title)}</span></div>
      <div class="t-sub">${escapeHtml(subtitle)}</div>
    </div>
    <div class="legend" id="leg">${legend}</div>
    <svg width="${W}" height="${H}" data-layout-ignore>
      <g class="gridg" id="gridg">
      ${grid}
      </g>
      <g class="xlab" id="xlab">
      ${xlabels}
      </g>
      <g id="lines">
      ${paths}
      </g>
      <g id="dots">
      ${markers}
      </g>
    </svg>
  </div>

  <script>
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    var N = ${n};

    // Snappy card + heading entrance (it's basically a hard cut in the ref).
    tl.fromTo("#card", { opacity: 0, scale: 0.985, y: 12 }, { opacity: 1, scale: 1, y: 0, duration: 0.30, ease: "power3.out" }, 0);
    tl.fromTo("#tblk", { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.32, ease: "power3.out" }, 0.06);
    // Marker-pen highlight wipes in behind the heading.
    tl.fromTo("#hlbar", { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: "power2.inOut" }, 0.22);
    tl.fromTo(".gridg", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, 0.12);
    tl.fromTo(".xlab", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, 0.16);
    tl.to(".chip", { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: 0.05 }, 0.16);

    // THE EFFECT — lines draw on left-to-right (stroke-dashoffset), snappy.
    var lines = document.querySelectorAll(".ln");
    lines.forEach(function (p, i) {
      var L = p.getTotalLength();
      p.style.strokeDasharray = L;
      p.style.strokeDashoffset = L;
      tl.to(p, { strokeDashoffset: 0, duration: ${drawDur.toFixed(2)}, ease: "power2.out" }, ${drawAt} + i * 0.05);
      // Markers for this series pop in following the draw front.
      var mk = document.querySelectorAll(".mk-" + i);
      gsap.set(mk, { transformOrigin: "50% 50%" });
      tl.to(mk, { opacity: 1, scale: 1, duration: 0.22, ease: "back.out(2.2)",
                  stagger: ${drawDur.toFixed(2)} / (N - 1) }, ${drawAt} + i * 0.05 + 0.04);
    });
    gsap.set(".mk", { scale: 0.2 });

    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// hf-chapter-card — 小Lin说-style dark/gold chapter title card.
//   scene.text convention (pipe-separated):  "第六章|多米诺骨牌|Dominoes|97-99"
//   → [chapterNo, titleCN, titleEN?, years?].  1 part → whole = titleCN.
// ──────────────────────────────────────────────────────────────────────────
const hfChapterCard: MethodRenderer = (scene, ctx) => {
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
  .chapno { font-family: ${ctx.design.sans}; font-size: 28px; letter-spacing: 0.34em; color: ${ctx.design.terra2}; opacity: 0;
    font-weight: 600; margin-bottom: 30px; padding-left: 0.34em; }
  .rule { width: 0; height: 3px; background: ${ctx.design.terra};
    margin: 30px 0; border-radius: 0; }
  .titlecn { font-size: 158px; font-weight: ${ctx.design.displayWeight}; letter-spacing: 0.04em; line-height: 1.06;
    font-family: ${ctx.design.display === "serif" ? ctx.design.serif : ctx.design.sans};
    color: ${ctx.design.ink}; opacity: 0; }
  .titleen { font-family: ${ctx.design.sans}; font-size: 30px; letter-spacing: 0.34em; text-transform: uppercase;
    color: ${ctx.design.muted}; opacity: 0; margin-top: 10px; }
  .years { font-family: ${ctx.design.sans}; margin-top: 44px; font-size: 24px; font-weight: 600; letter-spacing: 0.1em;
    color: ${ctx.design.pw}; background: ${ctx.design.terra}; padding: 8px 26px; border-radius: 4px; opacity: 0; }
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

// ──────────────────────────────────────────────────────────────────────────
// hf-stat-counter — big count-up number callout (gold, glow ring), 小Lin说 style.
//   scene.text convention:  "300|%|香港隔夜拆借利率|1997.10"
//   → [value, suffix?, label?, sublabel?].  value may carry a $/¥ prefix.
//   Numeric value counts 0→value (timeline-driven, seek-deterministic);
//   non-numeric (e.g. "10-15") shows literally.
// ──────────────────────────────────────────────────────────────────────────
const hfStatCounter: MethodRenderer = (scene, ctx) => {
  const p = scene.text.split("|").map((s) => s.trim());
  const rawVal = p[0] || scene.text;
  const suffix = p[1] || "";
  const label = p[2] || "";
  const sub = p[3] || "";
  const m = rawVal.match(/^([^\d.\-]*)([\d,]+(?:\.\d+)?)$/);
  const prefix = m ? m[1] : "";
  const numStr = m ? m[2].replace(/,/g, "") : "";
  const target = m ? parseFloat(numStr) : NaN;
  const decimals = m && /\.\d/.test(numStr) ? (numStr.split(".")[1].length) : 0;
  const countable = m != null && isFinite(target);
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
  .ring { position: absolute; width: 740px; height: 740px; border-radius: 50%;
    border: 1.5px solid ${ctx.design.line}; opacity: 0; }
  .sub { font-family: ${ctx.design.sans}; font-size: 28px; font-weight: 600; letter-spacing: 0.16em; color: ${ctx.design.terra2}; opacity: 0; margin-bottom: 22px; }
  .numwrap { display: flex; align-items: baseline; opacity: 0; }
  .num { font-size: 260px; font-weight: ${ctx.design.displayWeight}; line-height: 1; letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums; font-family: ${ctx.design.numberFamily === "serif" ? ctx.design.serif : ctx.design.sans}; color: ${ctx.design.ink}; }
  .pre { font-size: 120px; font-weight: 700; color: ${ctx.design.terra}; margin-right: 10px; }
  .suf { font-size: 108px; font-weight: 600; color: ${ctx.design.terra}; margin-left: 14px; }
  .label { font-family: ${ctx.design.sans}; font-size: 40px; font-weight: 600; color: ${ctx.design.ink2}; opacity: 0; margin-top: 40px; letter-spacing: 0.04em; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${d}" data-width="${ctx.width}" data-height="${ctx.height}">
  <div class="vig" data-layout-ignore></div>
  <div class="ring" data-layout-ignore></div>
  ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}
  <div class="numwrap">
    ${prefix ? `<span class="pre">${escapeHtml(prefix)}</span>` : ""}
    <span class="num" id="num">${countable ? "0" : escapeHtml(rawVal)}</span>
    ${suffix ? `<span class="suf">${escapeHtml(suffix)}</span>` : ""}
  </div>
  ${label ? `<div class="label">${escapeHtml(label)}</div>` : ""}
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const T = ${d};
    const numEl = document.getElementById("num");
    const DEC = ${decimals};
    function fmt(v){ var n = DEC>0 ? v.toFixed(DEC) : String(Math.round(v));
      var parts = n.split("."); parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
      return parts.join("."); }
    tl.fromTo(".ring", { opacity: 0, scale: 0.6 },
      { opacity: 1, scale: 1, duration: Math.min(0.9, T*0.6), ease: "power2.out" }, 0.1);
    tl.fromTo(".sub", { opacity: 0, y: -14 },
      { opacity: 1, y: 0, duration: Math.min(0.5, T*0.4), ease: "power2.out" }, 0.2);
    tl.fromTo(".numwrap", { opacity: 0, scale: 0.8, y: 24 },
      { opacity: 1, scale: 1, y: 0, duration: Math.min(0.7, T*0.5), ease: "back.out(1.6)" }, 0.3);
    ${countable ? `var st = { v: 0 };
    tl.to(st, { v: ${target}, duration: Math.min(1.8, T*0.7), ease: "power2.out",
      onUpdate: function(){ numEl.textContent = fmt(st.v); } }, 0.35);` : ``}
    tl.fromTo(".label", { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: Math.min(0.55, T*0.45), ease: "power3.out" }, 0.6);
    // entrance only — concat handles the cut
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────────
export const METHOD_RENDERERS: Record<string, MethodRenderer> = {
  "hf-css-fade": hfCssFade,
  "hf-kinetic-text": hfKineticText,
  "hf-anime-scatter": hfAnimeScatter,
  "hf-waapi-marker": hfWaapiMarker,
  "hf-tailwind-card": hfTailwindCard,
  "hf-lottie-play": hfLottiePlay,
  "rm-d3-bar-chart": rmD3BarChart,
  "rm-d3-line-trend": rmD3LineTrend,
  "rm-framer-card-stack": rmFramerCardStack,
  "rm-image-kenburns": rmImageKenburns,
  "rm-video-clip": rmVideoClip,
  "hf-poster-hero": hfPosterHero,
  "hf-mountain-reveal": hfMountainReveal,
  "hf-line-reveal": hfLineReveal,
  "hf-chapter-card": hfChapterCard,
  "hf-stat-counter": hfStatCounter,
};

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
