/**
 * Shared render toolkit for the method impls (src/methods/impl/<id>.ts).
 * Types + helpers that every renderer draws on. registry.ts re-exports the
 * public types from here so existing `from "./registry.ts"` imports keep working.
 */
import fs from "node:fs";
import path from "node:path";
import type { Scene, ResolvedDesign } from "../types.ts";
import { resolveDesign } from "./designs.ts";

// Legacy default for methods not yet ported to ctx.design (= inkwork preset).
// resolveDesign(undefined) returns inkwork tokens incl. terra/terra2 aliases,
// so existing BRAND token reads keep compiling. Remove once all read ctx.design.
export const BRAND = resolveDesign(undefined);

/** Look up the first generated bg image in scene.assets and return its absolute path. */
export function pickGeneratedBg(scene: Scene, ctx: RenderContext): { rel: string; absPath: string } | null {
  // Resolve against the project root (NOT process.cwd) so the daemon — whose cwd
  // is the repo root, not the project — finds assets under projects/<id>/assets/.
  // The sideFiles contract copies whatever path we return to the scene's temp folder.
  for (const rel of scene.assets ?? []) {
    if (!rel.startsWith("generated/")) continue;
    const abs = path.resolve(ctx.projectRoot, "assets", rel);
    if (fs.existsSync(abs)) return { rel, absPath: abs };
  }
  return null;
}

/** Map intensity → scale delta (how much zoom). */
export function intensityScale(intensity: "subtle" | "medium" | "strong" | undefined): number {
  if (intensity === "strong") return 0.22;
  if (intensity === "medium") return 0.14;
  return 0.06; // subtle default
}

/** Rec.709 relative luma of a #rrggbb hex (0–255); 128 if unparseable. */
export function relLuma(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return 128;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/**
 * Readable text color for text that sits OVER the dark photo veil the image
 * methods paint (rgba(5,3,8,~0.8)). The design's `ink` is dark on every light
 * preset (inkwork/swiss/magazine/claywarm) → near-invisible on that veil, so
 * pick the lighter of ink/paper: a dark-inked light design yields its paper
 * (light), a light-inked dark design (nocturne) keeps its ink. Preserves each
 * preset's character without ever going unreadable.
 */
export function onVeilText(d: ResolvedDesign): string {
  return relLuma(d.ink) >= relLuma(d.paper) ? d.ink : d.paper;
}

/** Darkest of ink/paper — for text on an intentionally fixed-light card (so a
 *  light-inked dark preset like nocturne still gets readable dark text there).
 *  Yields #1b1612 for inkwork, i.e. zero change to the default look. */
export function onLightCardText(d: ResolvedDesign): string {
  return relLuma(d.ink) <= relLuma(d.paper) ? d.ink : d.paper;
}

/** GSAP ease is interpolated raw into a generated <script>; a stray quote/newline
 *  would break the whole scene's timeline. Allow only ease-name characters,
 *  otherwise fall back to the house default. */
export function sanitizeEase(ease: string | undefined): string {
  const e = (ease || "").trim();
  return e.length > 0 && e.length <= 40 && /^[A-Za-z0-9_.\-(),% ]+$/.test(e) ? e : "power3.inOut";
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
export function buildMotionScript(scene: Scene): string {
  const m = scene.motion;
  if (!m || m.kind === "still") return "";
  const dur = scene.durationSec;
  const ease = sanitizeEase(m.ease);
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
export function buildFocusOverlay(scene: Scene): { css: string; html: string } {
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
    // 'dof' (lens blur) is a glass effect the 印刷工坊 aesthetic bans and the 土味
    // lint flags (backdrop-filter:blur). Honor the analyzer's intent — pull the
    // eye to a point — with a FLAT radial dim instead of a blur: no glass, no
    // lint self-flag, consistent with vignette/spotlight.
    return {
      css: `.focus-overlay { position: absolute; inset: 0; background: radial-gradient(ellipse at ${x}% ${y}%, rgba(0,0,0,0) ${(parseFloat(r) * 0.7).toFixed(0)}%, rgba(0,0,0,${dim}) 100%); pointer-events: none; z-index: 1; }`,
      html: `<div class="focus-overlay" data-layout-ignore></div>`,
    };
  }
  return { css: "", html: "" };
}

/** Resolve foreground (matted PNG) — full absolute path or null. */
export function pickForeground(scene: Scene, ctx: RenderContext): { rel: string; absPath: string } | null {
  if (!scene.foreground) return null;
  const abs = path.resolve(ctx.projectRoot, "assets", scene.foreground);
  if (!fs.existsSync(abs)) return null;
  return { rel: scene.foreground, absPath: abs };
}

export interface RenderContext {
  width: number;
  height: number;
  fps: number;
  /** Project root, used to resolve asset paths */
  projectRoot: string;
  /** Project title — used for editorial chrome (poster/mountain stamps) instead
   *  of hardcoded demo branding. Optional; methods fall back to a neutral label. */
  projectTitle?: string;
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

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
