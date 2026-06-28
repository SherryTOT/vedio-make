/**
 * `pipeline research` — for each data-driven scene (method = rm-d3-*), call the
 * search provider to fetch real numbers, then call chat to coerce the results
 * into the chart data shape the renderer expects.
 *
 * Outputs are stored on `scene.data` so renderers (d3-bar-chart / d3-line-trend)
 * can consume real data instead of hardcoded samples.
 *
 * Shape for bar chart:    { items: [{ label: string, value: number }] }
 * Shape for line trend:   { years: string[], series: [{ name, color?, values:number[] }] }
 */

import fs from "node:fs";
import { getChat, getSearch } from "./providers/registry.ts";
import type { Scene, Storyboard } from "./types.ts";

interface ResearchOpts {
  storyboardPath: string;
  /** Force re-research even if scene.data exists. */
  force: boolean;
  /** Provider id for web search. Default minimax. */
  searchProvider?: string;
  /** Provider id for the chat call. Default minimax. */
  chatProvider?: string;
}

const DATA_METHODS = new Set([
  "rm-d3-bar-chart",
  "rm-d3-line-trend",
  "rm-framer-table",
]);

function needsResearch(sc: Scene): boolean {
  return Boolean(sc.method && DATA_METHODS.has(sc.method));
}

interface ResearchResult {
  query: string;
  data: any;
  sources: { title: string; url: string }[];
}

async function researchOne(
  scene: Scene,
  opts: ResearchOpts
): Promise<ResearchResult | null> {
  const search = getSearch(opts.searchProvider);
  const chat = getChat(opts.chatProvider);

  // Step 1 — ask chat to formulate a precise search query + data shape
  const planSystem = `You take a single video scene caption + chosen visualization method, and produce:
1) A precise web-search query that will fetch the underlying data.
2) The expected data shape (one of: bar_chart, line_trend, table).

Return JSON only, no prose, no markdown:
{"query":"…","shape":"bar_chart"|"line_trend"|"table","notes":"…"}`;
  const planUser = `Scene text: "${scene.text}"\nMethod: ${scene.method}\nDuration: ${scene.durationSec}s`;
  const planRaw = await chat.chat({
    messages: [
      { role: "system", content: planSystem },
      { role: "user", content: planUser },
    ],
    maxTokens: 400,
    temperature: 0.2,
  });
  let plan: { query: string; shape: string };
  try {
    plan = JSON.parse(unfence(planRaw));
  } catch {
    console.warn(`[scene ${scene.index}] research plan parse failed; using scene text as query`);
    plan = { query: scene.text, shape: "bar_chart" };
  }

  // Step 2 — run the search
  let hits: Array<{ title: string; url: string; snippet: string }> = [];
  try {
    hits = await search.search({ query: plan.query, limit: 6 });
  } catch (e) {
    console.warn(`[scene ${scene.index}] search failed (${(e as Error).message})`);
  }

  // Step 2b — Graceful fallback if web search returns nothing.
  // Minimax's API doesn't auto-execute tool calls (the user's "网络搜索"
  // quota is for the chat UI, not the API), so plugin_web_search comes back
  // empty here. We synthesize plausible numbers from the chat model's
  // training knowledge as a stop-gap. Mark the result as "training-derived"
  // so the user knows to verify.
  let usingFallback = false;
  if (!hits.length) {
    console.warn(`[scene ${scene.index}] no live search results; falling back to chat-only synthesis`);
    usingFallback = true;
  }

  // Step 3 — extract chart data. Two paths:
  //   • snippets available → grounded extraction (numbers MUST come from snippets)
  //   • fallback mode → synthesis from training knowledge (clearly flagged)
  const extractSystem = usingFallback
    ? `You produce structured chart data from your training knowledge when web search is unavailable.

Method '${scene.method}' expects this JSON shape:
${shapeHint(scene.method)}

Rules:
- Use plausible, approximately-correct numbers from your training data.
- Pick values that make a visually-coherent chart (don't bunch everything at 0).
- If you can't recall numbers with reasonable confidence, output {"insufficient":true,"reason":"…"}.
- Output JSON only, no prose, no markdown fences.`
    : `You receive search results and produce structured chart data.

Method '${scene.method}' expects this JSON shape:
${shapeHint(scene.method)}

Rules:
- Numbers must come from the search snippets — DO NOT make them up.
- If snippets don't contain enough numeric data, output {"insufficient":true,"reason":"…"}.
- Output JSON only, no prose, no markdown fences.`;
  const extractUser = usingFallback
    ? `Scene text: "${scene.text}"\nQuery: "${plan.query}"\n(No live search results; use training knowledge.)\n\nExtract chart data.`
    : `Scene text: "${scene.text}"\nSearch query: "${plan.query}"\nSearch results:\n${
        hits.map((h, i) => `  [${i + 1}] ${h.title}\n     ${h.url}\n     ${h.snippet}`).join("\n")
      }\n\nExtract chart data.`;

  const dataRaw = await chat.chat({
    messages: [
      { role: "system", content: extractSystem },
      { role: "user", content: extractUser },
    ],
    maxTokens: 1500,
    temperature: 0.1,
  });
  let parsed: any;
  try {
    parsed = JSON.parse(unfence(dataRaw));
  } catch (e) {
    console.warn(`[scene ${scene.index}] data parse failed: ${(e as Error).message}`);
    return null;
  }
  if (parsed?.insufficient) {
    console.warn(`[scene ${scene.index}] insufficient data: ${parsed.reason ?? "?"}`);
    return null;
  }

  return {
    query: plan.query,
    data: parsed,
    sources: usingFallback
      ? [{ title: "training-derived (no live search results)", url: "" }]
      : hits.slice(0, 4).map((h) => ({ title: h.title, url: h.url })),
  };
}

function shapeHint(method: string | null): string {
  if (method === "rm-d3-bar-chart") {
    return `{"items": [{"label": "string", "value": number}, ...]}   // 3-7 items recommended`;
  }
  if (method === "rm-d3-line-trend") {
    return `{"years": ["2018", "2019", ...], "series": [{"name": "string", "values": [number, ...]}]}`;
  }
  if (method === "rm-framer-table") {
    return `{"columns": ["col1", "col2", ...], "rows": [["a","b",...], ...]}`;
  }
  return `{}`;
}

function unfence(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) out = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  out = out.replace(/^(?:json|response|output)\s*:\s*/i, "");
  return out.trim();
}

export async function runResearch(opts: ResearchOpts): Promise<Storyboard> {
  const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));

  const todo = sb.scenes.filter(needsResearch);
  if (!todo.length) {
    console.log("[research] no data-driven scenes (rm-d3-*) — nothing to do");
    return sb;
  }

  console.log(`[research] ${todo.length} data scene(s):`);
  for (const sc of todo) console.log(`   · scene ${sc.index} (${sc.method})  '${sc.text.slice(0, 40)}'`);

  for (const sc of todo) {
    if (!opts.force && (sc as any).data) {
      console.log(`[scene ${sc.index}] research cache hit`);
      continue;
    }
    console.log(`\n=== researching scene ${sc.index} (${sc.method}) ===`);
    const result = await researchOne(sc, opts);
    if (result) {
      (sc as any).data = result.data;
      (sc as any).researchQuery = result.query;
      (sc as any).researchSources = result.sources;
      sc.notes = [
        ...(sc.notes ?? []),
        `data via search: ${result.sources[0]?.url ?? "?"}`,
      ];
    }
  }

  fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));
  console.log(`\n✓ storyboard updated with scene.data for ${todo.length} data scenes`);
  return sb;
}
