/**
 * Minimax web search via chat tools (web_search built-in).
 *
 * Minimax exposes web search as a TOOL the chat model can invoke. We make a
 * dedicated call with `tools: [{type:"web_search"}]` and `tool_choice` forcing
 * the model to search, then we parse the returned tool_calls / annotations.
 *
 * Returns normalized result list — title / url / snippet.
 */

import type { SearchClient } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";

export const minimaxSearch: SearchClient = {
  id: "minimax",
  async search({ query, limit = 5, recency = "any" }) {
    const cfg = loadProviderConfig("minimax");

    // Use a chat call to ask the model to search and return JSON.
    const systemMsg = {
      role: "system" as const,
      content:
        "You are a web research assistant. When the user asks a query, use the web search tool to find relevant pages. " +
        "Then return ONLY a JSON array of the top results in this shape (no prose, no markdown fences): " +
        `[{"title":"…","url":"https://…","snippet":"…"}]. ` +
        `Return at most ${limit} entries.${recency !== "any" ? ` Prefer pages from the last ${recency}.` : ""}`,
    };
    const userMsg = { role: "user" as const, content: query };

    const resp = await fetch(`${cfg.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model || "MiniMax-M2.7-highspeed",
        messages: [systemMsg, userMsg],
        max_tokens: 2048,
        temperature: 0.0,
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
      }),
    });

    if (!resp.ok) {
      throw new Error(`Minimax search ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as any;
    let content: string = data?.choices?.[0]?.message?.content ?? "";
    content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    content = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .replace(/^(?:json|response|results?)\s*:\s*/i, "")
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // If the model returned narrative text, fall back to extracting URLs.
      const urls = [...content.matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0]);
      return urls.slice(0, limit).map((u) => ({ title: u, url: u, snippet: "" }));
    }
    if (!Array.isArray(parsed)) {
      // Some shapes: { results: [...] } or { data: [...] }
      parsed = parsed?.results ?? parsed?.data ?? [];
    }
    return (parsed as any[])
      .slice(0, limit)
      .map((r) => ({
        title: String(r.title ?? r.name ?? ""),
        url: String(r.url ?? r.link ?? ""),
        snippet: String(r.snippet ?? r.summary ?? r.description ?? ""),
      }))
      .filter((r) => r.url);
  },
};
