/**
 * Slideshow-risk scorer — predicts whether a storyboard will feel like a
 * templated caption slideshow rather than a directed piece, and warns BEFORE
 * rendering. Advisory only: it never blocks a render.
 *
 * Clean-room + DELIBERATELY ADAPTED from OpenMontage's slideshow_risk.py.
 * OpenMontage penalizes "lack of motion / weak cinematic spectacle" — that would
 * fight Vedio Make's 印刷工坊 aesthetic, which is intentionally restrained and
 * static-leaning. So this scores MONOTONY / VARIETY / JUSTIFICATION instead —
 * signals that are aesthetic-neutral: too much of the same method, an all-text
 * board, unmotivated scenes, and no rhythm in pacing. A tasteful letterpress
 * video can be calm; it should not be repetitive.
 *
 * Each dimension is 0–5 (lower is better). Verdict:
 *   < 2.0 strong · < 3.0 acceptable · < 4.0 revise · ≥ 4.0 fail
 */
import fs from "node:fs";
import path from "node:path";
import type { Scene, Storyboard } from "./types.ts";

export interface RiskDimension { score: number; reason: string }
export interface RiskReport {
  average: number;
  verdict: "strong" | "acceptable" | "revise" | "fail";
  dimensions: Record<string, RiskDimension>;
}

const clamp = (x: number, lo = 0, hi = 5) => Math.max(lo, Math.min(hi, x));
/** Linear ramp: at `from` → 0, at `to` → 5. */
const ramp = (v: number, from: number, to: number) => clamp(((v - from) / (to - from)) * 5);

/** Method ids that are "text-led" (tags ⊆ text-ish AND no asset needs), from catalog if present. */
function textLedMethods(projectRoot: string): Set<string> | null {
  const roots = [
    path.resolve(projectRoot, "methods", "catalog.json"),
    path.resolve(process.cwd(), "methods", "catalog.json"),
  ];
  for (const p of roots) {
    try {
      const cat = JSON.parse(fs.readFileSync(p, "utf8"));
      const methods: any[] = cat.methods ?? [];
      if (!methods.length) continue;
      const textTags = new Set(["text", "caption", "subtitle", "title", "quote", "list"]);
      const out = new Set<string>();
      for (const m of methods) {
        const needs: string[] = m.assetNeeds ?? [];
        const tags: string[] = m.tags ?? [];
        if (needs.length === 0 && tags.some((t) => textTags.has(t))) out.add(m.id);
      }
      return out;
    } catch { /* try next */ }
  }
  return null;
}

/** Is a scene "text-led"? Uses the catalog set when available, else a field heuristic. */
function isTextLed(s: Scene, textSet: Set<string> | null): boolean {
  if (textSet && s.method) return textSet.has(s.method);
  // Fallback heuristic: no visual payload attached.
  return (s.assets?.length ?? 0) === 0 && !s.data && !s.foreground;
}

export function scoreSlideshowRisk(sb: Storyboard, projectRoot: string): RiskReport {
  const scenes = sb.scenes ?? [];
  const n = scenes.length;
  if (n === 0) {
    return { average: 5, verdict: "fail", dimensions: { empty: { score: 5, reason: "没有镜头" } } };
  }
  if (n < 3) {
    // Too short to be a "slideshow"; only flag if literally one repeated method.
    return { average: 0, verdict: "strong", dimensions: { short: { score: 0, reason: `只有 ${n} 个镜头,不构成幻灯片风险` } } };
  }

  const dims: Record<string, RiskDimension> = {};

  // 1) method_repetition — how dominant is the single most-used method.
  {
    const counts = new Map<string, number>();
    for (const s of scenes) counts.set(s.method ?? "∅", (counts.get(s.method ?? "∅") ?? 0) + 1);
    let topId = "", top = 0;
    for (const [id, c] of counts) if (c > top) { top = c; topId = id; }
    const share = top / n;
    dims.method_repetition = {
      score: ramp(share, 0.45, 0.95), // 45% → 0, 95% → 5
      reason: `最常用方法 '${topId}' 占 ${Math.round(share * 100)}%（${top}/${n} 镜）${share >= 0.6 ? " — 换些方法增加视觉节奏" : ""}`,
    };
  }

  // 2) text_overreliance — fraction of the board that is pure typographic cards.
  {
    const textSet = textLedMethods(projectRoot);
    const textLed = scenes.filter((s) => isTextLed(s, textSet)).length;
    const frac = textLed / n;
    dims.text_overreliance = {
      score: ramp(frac, 0.6, 1.0), // a letterpress video CAN be typographic; only flag when it's nearly ALL text
      reason: `${Math.round(frac * 100)}% 的镜头是纯文字卡（${textLed}/${n}）${frac >= 0.8 ? " — 插入图/图表/留白镜头调剂" : ""}`,
    };
  }

  // 3) intent_absence — scenes the analyzer never justified (proxy for "decorative / unmotivated").
  {
    const noReason = scenes.filter((s) => !s.reasoning || !s.reasoning.trim()).length;
    const frac = noReason / n;
    dims.intent_absence = {
      score: ramp(frac, 0.4, 1.0),
      reason: `${Math.round(frac * 100)}% 的镜头没有写清「为什么这样做」（reasoning 空）${frac >= 0.6 ? " — 让分析器补上镜头意图" : ""}`,
    };
  }

  // 4) pacing_monotony — a metronomic slideshow has NEITHER duration variation
  //    NOR method variety. Rhythm from EITHER dimension lowers the risk; risk is
  //    high only when BOTH are flat. (Earlier this inverted: uniform durations
  //    scored max risk even when the methods were varied.)
  {
    const durs = scenes.map((s) => s.durationSec).filter((d) => d > 0);
    const mean = durs.reduce((a, b) => a + b, 0) / (durs.length || 1);
    const variance = durs.reduce((a, d) => a + (d - mean) ** 2, 0) / (durs.length || 1);
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // duration coefficient of variation
    const distinctMethods = new Set(scenes.map((s) => s.method ?? "∅")).size;
    const distinctFrac = distinctMethods / n;
    // rhythm ≥ 1 (plenty) when durations vary (cv≈0.25) OR ~half the methods differ.
    const rhythm = Math.min(1, Math.max(cv / 0.25, distinctFrac / 0.5));
    const metronomic = cv < 0.12 && distinctMethods <= Math.max(2, Math.ceil(n * 0.25));
    dims.pacing_monotony = {
      score: clamp(5 * (1 - rhythm)),
      reason: metronomic
        ? `镜头时长几乎一致(变异系数 ${cv.toFixed(2)})且方法种类少(${distinctMethods}/${n}) — 节奏偏机械`
        : `节奏尚可(时长变异 ${cv.toFixed(2)},方法 ${distinctMethods}/${n} 种)`,
    };
  }

  const scores = Object.values(dims).map((d) => d.score);
  const average = scores.reduce((a, b) => a + b, 0) / scores.length;
  const verdict = average < 2 ? "strong" : average < 3 ? "acceptable" : average < 4 ? "revise" : "fail";
  return { average: Math.round(average * 100) / 100, verdict, dimensions: dims };
}
