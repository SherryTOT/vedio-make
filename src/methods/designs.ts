// src/methods/designs.ts
// Multi-style preset catalog + resolver. The single source of truth for the look.
// inkwork is the default and reproduces the original hardcoded BRAND exactly.
import type {
  DesignTokens, DesignMotion, DesignSelection, ResolvedDesign,
} from "../types.ts";

export const DEFAULT_DESIGN_ID = "inkwork";

export interface Design {
  id: string;
  name: string;        // human label for the 整体设计 panel
  vibe: string;        // one-paragraph art-direction summary
  whenToUse: string;   // guidance shown as a hint in the picker
  tokens: DesignTokens;
  motion: DesignMotion;
}

export const DESIGNS: Record<string, Design> = {
  // ── 印刷工坊 (default — byte-identical look to the original BRAND) ──
  inkwork: {
    id: "inkwork",
    name: "印刷工坊 · Inkwork",
    vibe: "Letterpress editorial workshop. Warm cream stock, deep brown-black ink, one hand-set terracotta rule. Quiet, intentional, serif voice, generous negative space, no effects.",
    whenToUse: "默认风格。叙述为主、金句卡、章节分隔、长中文阅读、字体驱动的标题钩子。",
    tokens: {
      paper: "#f6f5f1", pw: "#ffffff",
      ink: "#1b1612", ink2: "#46403a", muted: "#8a8174",
      accent: "#c36c36", accent2: "#9e5326",
      line: "rgba(27,22,18,0.12)",
      serif: `"Noto Serif SC", "Songti SC", "Source Han Serif SC", serif`,
      sans: `"Noto Sans SC", -apple-system, "PingFang SC", sans-serif`,
      display: "serif", displayWeight: 700, numberFamily: "serif",
      chartPalette: ["#c36c36", "#1b1612", "#8a8174", "#9e5326", "#3f8f5e"],
    },
    motion: { ease: "power3.out", tempo: "deliberate", enter: "rise" },
  },

  // ── 极简黑白 · Swiss ──
  swiss: {
    id: "swiss",
    name: "极简黑白 · Swiss",
    vibe: "International Typographic discipline: pure white, near-black, one signal red. Big tight-tracked sans, strict grid, hairline rules. Cool, exact, no decoration.",
    whenToUse: "要权威与精确而非温度:数据向解说、大数字、列表拆解、折线图、硬钩子。科技/财经/科普。",
    tokens: {
      paper: "#ffffff", pw: "#f4f4f2",
      ink: "#111111", ink2: "#3a3a3a", muted: "#8a8a8a",
      accent: "#d8382b", accent2: "#a82217",
      line: "rgba(17,17,17,0.14)",
      serif: `"Noto Serif SC", "Songti SC", serif`,
      sans: `"Noto Sans SC", -apple-system, "PingFang SC", sans-serif`,
      display: "sans", displayWeight: 700, numberFamily: "sans",
      chartPalette: ["#d8382b", "#111111", "#8a8a8a", "#a82217", "#3a3a3a"],
    },
    motion: { ease: "power3.out", tempo: "snappy", enter: "rise" },
  },

  // ── 杂志编辑 (cobalt feature spread) ──
  magazine: {
    id: "magazine",
    name: "杂志编辑 · Magazine",
    vibe: "Bold print-magazine editorial: pale warm paper, near-black ink, confident cobalt accent under a huge serif display at dramatic scale. Loud in scale, quiet in color.",
    whenToUse: "标题钩子、引文、章节卡、特稿式叙述,想要权威的印刷气场。巨号衬线适合标题/引文镜。不适合密集数据表。",
    tokens: {
      paper: "#f4f1e9", pw: "#fcfbf6",
      ink: "#15171c", ink2: "#3c4049", muted: "#6e727c",
      accent: "#1f49c7", accent2: "#16245e",
      line: "rgba(21,23,28,0.12)",
      serif: `"Noto Serif SC", "Songti SC", serif`,
      sans: `"Noto Sans SC", -apple-system, "PingFang SC", sans-serif`,
      display: "serif", displayWeight: 800, numberFamily: "serif",
      chartPalette: ["#1f49c7", "#15171c", "#6e727c", "#16245e", "#3f8f5e"],
    },
    motion: { ease: "power3.out", tempo: "deliberate", enter: "rise" },
  },

  // ── Nocturne (restrained dark) ──
  nocturne: {
    id: "nocturne",
    name: "克制深色 · Nocturne",
    vibe: "Restrained flat-charcoal dark. Premium, serious, quiet. Warm off-white type on cool charcoal, one muted sage accent as a rule or single number — never a glow.",
    whenToUse: "科技、财经、分析、产品解说——要深色又冷静权威而非花哨。大数字、折线图、引文、章节卡。不适合暖系生活内容。",
    tokens: {
      paper: "#1a1c1e", pw: "#212427",
      ink: "#eceae4", ink2: "#a9aeaf", muted: "#6e7679",
      accent: "#8aa893", accent2: "#5e7e6b",
      line: "rgba(236,234,228,0.12)",
      serif: `"Noto Serif SC", "Songti SC", serif`,
      sans: `"Noto Sans SC", -apple-system, "PingFang SC", sans-serif`,
      display: "sans", displayWeight: 700, numberFamily: "sans",
      chartPalette: ["#8aa893", "#eceae4", "#6e7679", "#5e7e6b", "#c9a05e"],
    },
    motion: { ease: "power3.out", tempo: "deliberate", enter: "settle" },
  },

  // ── 暖手作 (warm handcraft) ──
  claywarm: {
    id: "claywarm",
    name: "暖手作 · Claywarm",
    vibe: "Warm handcraft and lifestyle. Soft oat-cream paper, espresso ink, clay-terracotta and muted-olive accents. Friendly rounded sans display with relaxed tracking. Cozy, organic, flat throughout.",
    whenToUse: "生活、美食、手作、健康、家居、慢生活、创客内容。温暖的清单/食谱/routine 卡、亲和的大数字。不适合锐利的科技/财经/硬新闻。",
    tokens: {
      paper: "#f4ede1", pw: "#fbf6ec",
      ink: "#33271e", ink2: "#6b5848", muted: "#9a8b7a",
      accent: "#a85c36", accent2: "#5f6240",
      line: "rgba(51,39,30,0.12)",
      serif: `"Noto Serif SC", "Songti SC", serif`,
      sans: `"Noto Sans SC", -apple-system, "PingFang SC", sans-serif`,
      display: "sans", displayWeight: 600, numberFamily: "sans",
      chartPalette: ["#a85c36", "#33271e", "#9a8b7a", "#5f6240", "#3f8f5e"],
    },
    motion: { ease: "power2.out", tempo: "gentle", enter: "settle" },
  },
};

/** Resolve a single selection: preset tokens shallow-merged with overrides. */
export function resolveDesign(sel: DesignSelection | undefined): ResolvedDesign {
  const preset = DESIGNS[sel?.presetId ?? DEFAULT_DESIGN_ID] ?? DESIGNS[DEFAULT_DESIGN_ID];
  const tokens: DesignTokens = { ...preset.tokens, ...(sel?.overrides ?? {}) };
  return {
    ...tokens,
    motion: { ...preset.motion, ...(sel?.overrides?.motion ?? {}) },
    __presetId: preset.id,
  };
}

/** Compose project + scene selection. Scene wins.
 *  - scene with a *different* presetId → that preset fresh (+ its own overrides);
 *  - scene with only overrides → layered on the project-resolved set. */
export function resolveSceneDesign(
  project: DesignSelection | undefined,
  scene: { presetId?: string; overrides?: Partial<DesignTokens> } | undefined,
): ResolvedDesign {
  const base = resolveDesign(project);
  if (!scene) return base;
  if (scene.presetId && scene.presetId !== base.__presetId) {
    if (DESIGNS[scene.presetId]) {
      return resolveDesign({ presetId: scene.presetId, overrides: scene.overrides });
    }
    // Unknown/typo'd scene presetId: DON'T silently snap to inkwork (that's the
    // old bug — a typo dragged the scene onto the default preset instead of the
    // project's). Keep the project's design and just layer any overrides.
    console.warn(`[design] 镜头风格 presetId '${scene.presetId}' 未知 — 沿用项目风格 '${base.__presetId}'`);
  }
  const tokens: DesignTokens = { ...base, ...(scene.overrides ?? {}) };
  return {
    ...tokens,
    motion: { ...base.motion, ...(scene.overrides?.motion ?? {}) },
    __presetId: base.__presetId,
  };
}
