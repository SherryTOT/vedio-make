// src/methods/lint.ts
// 土味 lint — scan a generated composition's source for "AI slop" signals the
// brand bans (gradient text, glow, glassmorphism, AI gold/purple palettes).
// Used both at render time (warn into the task log) and via /api/projects/:id/lint.
import { METHOD_RENDERERS } from "./registry.ts";
import type { RenderContext } from "./registry.ts";
import { resolveSceneDesign } from "./designs.ts";
import type { Storyboard } from "../types.ts";

export interface LintFinding { code: string; msg: string; }

const RULES: { code: string; msg: string; test: (s: string) => boolean }[] = [
  {
    code: "gradient-text",
    msg: "渐变文字(-webkit-text-fill-color:transparent + gradient)——改纯色墨字",
    test: (s) => /text-fill-color:\s*transparent/i.test(s) && /(?:linear|radial)-gradient/i.test(s),
  },
  {
    code: "glow",
    msg: "发光/光晕(drop-shadow 0 0 …)——去掉",
    test: (s) => /drop-shadow\(\s*0\s+0\s/i.test(s),
  },
  {
    code: "glass",
    msg: "玻璃拟态(backdrop-filter: blur)——去掉",
    test: (s) => /backdrop-filter:\s*blur/i.test(s),
  },
  {
    code: "ai-palette",
    msg: "AI 金光/紫光配色(金 #f4d479/紫 rgba(80,40,140) 等)——换品牌色",
    test: (s) => /#f4d479|#ecbe53|#f7e4a6|#e9b84a|rgba\(\s*80,\s*40,\s*140|rgba\(\s*244,\s*212,\s*121/i.test(s),
  },
  {
    code: "many-gradients",
    msg: "渐变过多(克制审美应以纯色 + 发丝线为主)",
    test: (s) => ((s.match(/(?:linear|radial)-gradient/gi) || []).length >= 4),
  },
];

export function lintSource(src: string): LintFinding[] {
  if (!src) return [];
  return RULES.filter((r) => r.test(src)).map(({ code, msg }) => ({ code, msg }));
}

export interface SceneLint { index: number; method: string | null; findings: LintFinding[]; }

/** Lint every scene by generating its source through the real renderer + resolved design. */
export function lintStoryboard(sb: Storyboard, projectRoot: string): SceneLint[] {
  const out: SceneLint[] = [];
  for (const scene of sb.scenes) {
    if (!scene.method) { out.push({ index: scene.index, method: null, findings: [] }); continue; }
    const renderer = METHOD_RENDERERS[scene.method];
    if (!renderer) { out.push({ index: scene.index, method: scene.method, findings: [] }); continue; }
    const ctx: RenderContext = {
      width: sb.project.width,
      height: sb.project.height,
      fps: sb.project.fps,
      projectRoot,
      design: resolveSceneDesign(sb.project.design, scene.style),
    };
    let src = "";
    try { const o = renderer(scene, ctx); src = o.engine === "hyperframes" ? o.html : o.tsx; } catch {}
    out.push({ index: scene.index, method: scene.method, findings: lintSource(src) });
  }
  return out;
}
