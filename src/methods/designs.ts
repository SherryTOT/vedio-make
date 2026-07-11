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

// ───────────────────────────────────────────────────────────────────────────
// Image-prompt palette — natural-language colour derived from the LIVE tokens.
//
// The 整体设计 panel lets users override paper/ink/accent to any hex, so a
// generated background must describe the *current* colours, not a frozen preset
// string. That keeps生图 素材 and the layout the same blood-type (DIRECTION §〇).
// Pure + deterministic: same tokens → same text. Print-workshop guardrails
// (matte / flat / no gradient / glow / metallic) are baked into the sentence so
// image models can't smuggle back the AI-gold look the design system forbids.
// ───────────────────────────────────────────────────────────────────────────

const HUE_NAMES: Array<[number, string]> = [
  [16, "red"], [40, "orange"], [52, "amber"], [68, "yellow"],
  [95, "yellow-green"], [150, "green"], [185, "teal"], [205, "cyan"],
  [250, "blue"], [275, "indigo"], [305, "violet"], [340, "magenta"], [360, "red"],
];

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Approximate an English colour name for a #rrggbb value (override-safe). */
export function hexToName(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return "neutral";
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const L = (max + min) / 510;          // lightness 0..1
  const chroma = (max - min) / 255;     // colourfulness 0..1
  const warm = r - b > 4;               // warm (reddish/amber) vs cool tint
  let h = 0;
  if (chroma > 0) {
    const d = max - min;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h * 60; if (h < 0) h += 360;
  }
  // Pale / near-white tier — creams and off-whites, never "pale orange".
  if (L >= 0.86 && chroma < 0.16) {
    if (chroma < 0.015 && Math.abs(r - b) <= 3) return "bright white";
    return warm ? "warm cream" : "cool off-white";
  }
  // Near-neutral greys / blacks.
  if (chroma < 0.06) {
    if (L >= 0.55) return "light grey";
    if (L >= 0.32) return "mid grey";
    if (L >= 0.16) return warm ? "warm charcoal" : "charcoal";
    return warm ? "warm near-black" : "near-black";
  }
  // Warm dark low-chroma orange/amber reads as brown, not "dark orange".
  if (h >= 12 && h < 50 && L < 0.5 && chroma < 0.6) {
    if (L < 0.22) return "deep brown-black";
    if (L < 0.38) return "espresso brown";
    return "terracotta brown";
  }
  const hue = HUE_NAMES.find(([hi]) => h < hi)![1];
  const lightWord =
    L >= 0.85 ? "pale " : L >= 0.68 ? "light " : L >= 0.42 ? "" : L >= 0.24 ? "deep " : "dark ";
  const satWord = chroma < 0.30 ? "muted " : "";
  return `${lightWord}${satWord}${hue}`.trim();
}

/** True when the paper (background) token is a dark scheme (Rec.709 luma < 0.5). */
export function isDarkPaper(paper: string): boolean {
  const rgb = parseHex(paper);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

/** Natural-language palette sentence for image-generation prompts. */
export function tokensToPromptPalette(
  d: Pick<DesignTokens, "paper" | "ink" | "accent">,
): string {
  const bg = hexToName(d.paper), ink = hexToName(d.ink), acc = hexToName(d.accent);
  const scheme = isDarkPaper(d.paper)
    ? `restrained dark scheme — ${bg} background, ${ink} text`
    : `restrained light scheme — ${bg} paper, ${ink} ink`;
  return `${scheme}, ${acc} as the single accent colour. Matte, flat, print-like colour: no gradients, no glow, no neon, no metallic gold sheen.`;
}
