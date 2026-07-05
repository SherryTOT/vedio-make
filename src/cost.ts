/**
 * Cost estimation — order-of-magnitude visibility BEFORE you spend on paid
 * providers, not billing-grade accounting. Free providers (Edge/Piper TTS,
 * HyperFrames/Remotion render, Pexels/Unsplash stock) cost $0.
 *
 * Deliberately NOT a budget tracker with caps/approval gates — that's overkill
 * for a single-user local tool. This just answers "roughly what will this
 * storyboard cost to voice + illustrate?" so there are no surprise bills.
 *
 * Prices are rough PUBLIC-ish list estimates in USD; tweak the constants below
 * as provider pricing changes.
 */
import type { Storyboard } from "./types.ts";

const TTS_USD_PER_1K_CHARS: Record<string, number> = {
  minimax: 0.02, // ~¥0.1–0.3/万字 的粗略折算
  // "voice" is the DEFAULT router: bare voiceIds (incl. the default presenter_male)
  // route to PAID MiniMax, NOT the free Edge path — so estimate it as MiniMax, not
  // $0. Users on the free path pass ttsProvider:"edge" explicitly (absent → free).
  voice: 0.02,
  openai: 0.03, // adapter uses tts-1-hd ≈ $30 / 1M chars (tts-1 would be 0.015)
  // edge / piper = 免费(不在表内 → 0)
};
const IMAGE_USD_PER_IMAGE: Record<string, number> = {
  minimax: 0.03,
  openai: 0.04, // dall-e-3 1024²
};
const MUSIC_USD_PER_TRACK: Record<string, number> = {
  minimax: 0.2,
};

export interface CostLineItem {
  category: "tts" | "image" | "music";
  provider: string;
  quantity: number;
  unit: string;
  unitUsd: number;
  totalUsd: number;
  basis: string;
  free: boolean;
}
export interface CostEstimate {
  lineItems: CostLineItem[];
  totalUsd: number;
  lowUsd: number;
  highUsd: number;
  confidence: "high" | "medium" | "low";
  disclaimer: string;
}

export interface EstimateOpts {
  /** Resolved provider ids. Unknown/free ones count as $0. */
  ttsProvider?: string;
  imageProvider?: string;
  musicProvider?: string;
  /** Whether each capability will actually run. Sensible defaults from the board. */
  withTts?: boolean;
  withImages?: boolean;
  withMusic?: boolean;
}

const IMG_EXT = /\.(jpg|jpeg|png|webp)$/i;
const round = (n: number) => Math.round(n * 100) / 100;

export function estimateStoryboard(sb: Storyboard, opts: EstimateOpts = {}): CostEstimate {
  const scenes = sb.scenes ?? [];
  const items: CostLineItem[] = [];

  // ─ TTS: charged per character of narration ─
  const withTts = opts.withTts ?? scenes.some((s) => (s.text ?? "").trim().length > 0);
  if (withTts) {
    const chars = scenes.reduce((a, s) => a + (s.text ?? "").replace(/\s/g, "").length, 0);
    const provider = opts.ttsProvider ?? "voice";
    const per1k = TTS_USD_PER_1K_CHARS[provider] ?? 0;
    const free = per1k === 0;
    items.push({
      category: "tts", provider, quantity: chars, unit: "字",
      unitUsd: per1k / 1000, totalUsd: round((chars / 1000) * per1k),
      basis: `${scenes.length} 镜共 ${chars} 字${free ? "(免费 provider)" : ""}`, free,
    });
  }

  // ─ Images: scenes that call for a generated illustration and don't have one ─
  const imageScenes = scenes.filter((s) => s.imageStyle && !(s.assets ?? []).some((a) => IMG_EXT.test(a)));
  const withImages = opts.withImages ?? imageScenes.length > 0;
  if (withImages && imageScenes.length) {
    const provider = opts.imageProvider ?? "minimax";
    const per = IMAGE_USD_PER_IMAGE[provider] ?? 0;
    const free = per === 0;
    items.push({
      category: "image", provider, quantity: imageScenes.length, unit: "张",
      unitUsd: per, totalUsd: round(imageScenes.length * per),
      basis: `${imageScenes.length} 镜带 imageStyle 且尚无配图${free ? "(免费/图库)" : ""}`, free,
    });
  }

  // ─ Music: one BGM track, only if requested ─
  if (opts.withMusic) {
    const provider = opts.musicProvider ?? "minimax";
    const per = MUSIC_USD_PER_TRACK[provider] ?? 0;
    items.push({
      category: "music", provider, quantity: 1, unit: "首",
      unitUsd: per, totalUsd: round(per), basis: "1 首背景音乐", free: per === 0,
    });
  }

  const totalUsd = round(items.reduce((a, i) => a + i.totalUsd, 0));
  const paidItems = items.filter((i) => !i.free && i.totalUsd > 0).length;
  const confidence: CostEstimate["confidence"] = paidItems === 0 ? "high" : paidItems <= 1 ? "medium" : "low";
  return {
    lineItems: items,
    totalUsd,
    lowUsd: round(totalUsd * 0.6),
    highUsd: round(totalUsd * 1.6),
    confidence,
    disclaimer: "仅为数量级估算(非账单)。免费 provider(Edge/Piper 配音、HyperFrames/Remotion 渲染、Pexels/Unsplash 图库)计 $0。单价见 src/cost.ts,按需调整。",
  };
}

/** One-line summary for CLI / logs. */
export function summarizeCost(e: CostEstimate): string {
  if (e.totalUsd === 0) return `预估成本 ~$0(全部走免费 provider)`;
  return `预估成本 ~$${e.totalUsd.toFixed(2)}(区间 $${e.lowUsd.toFixed(2)}–$${e.highUsd.toFixed(2)},置信度 ${e.confidence})`;
}
