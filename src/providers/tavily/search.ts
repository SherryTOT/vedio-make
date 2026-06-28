/**
 * Tavily web search — drop-in alternative to Minimax search.
 * Tavily has a generous free tier (1k searches/month) and a clean API.
 *
 * Config: TAVILY_API_KEY env var, or providers.json id="tavily".
 * Docs: https://docs.tavily.com/docs/rest-api/api-reference
 */

import type { SearchClient } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";

export const tavilySearch: SearchClient = {
  id: "tavily",
  async search({ query, limit = 5, recency = "any" }) {
    const cfg = loadProviderConfig("tavily");
    const baseUrl = cfg.base_url || "https://api.tavily.com";
    const resp = await fetch(`${baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: cfg.api_key,
        query,
        max_results: limit,
        time_range: recency === "any" ? undefined : recency,
        include_answer: false,
        search_depth: "basic",
      }),
    });
    if (!resp.ok) {
      throw new Error(`Tavily search ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as any;
    const results = data?.results ?? [];
    return results.map((r: any) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      snippet: String(r.content ?? r.snippet ?? ""),
    }));
  },
};
