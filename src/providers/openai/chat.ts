/**
 * OpenAI chat — alternative analyzer backend.
 * Config: OPENAI_API_KEY env var, optional providers.json entry id="openai".
 * Default model: gpt-4o-mini (cheap+good for the analyzer).
 */

import type { ChatClient } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";

export const openaiChat: ChatClient = {
  id: "openai",
  async chat({ messages, maxTokens = 4096, temperature = 0.3, model }) {
    const cfg = loadProviderConfig("openai");
    const baseUrl = cfg.base_url || "https://api.openai.com/v1";
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model ?? cfg.model ?? "gpt-4o-mini",
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!resp.ok) {
      throw new Error(`OpenAI chat ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as any;
    return (data?.choices?.[0]?.message?.content ?? "").trim();
  },
};
