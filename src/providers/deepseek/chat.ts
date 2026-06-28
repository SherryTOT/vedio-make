/**
 * DeepSeek chat — OpenAI-compatible, drop-in alternative to Minimax for the
 * analyzer step. Same `Authorization: Bearer …` + JSON body shape; only the
 * base URL and default model differ.
 *
 * Config: ~/.video-toolkit/providers.json `id: "deepseek"` (api_key from
 * Keychain) OR DEEPSEEK_API_KEY env var.
 */

import type { ChatClient } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";

export const deepseekChat: ChatClient = {
  id: "deepseek",
  async chat({ messages, maxTokens = 4096, temperature = 0.3, model }) {
    const cfg = loadProviderConfig("deepseek");
    const resp = await fetch(`${cfg.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model ?? cfg.model ?? "deepseek-chat",
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!resp.ok) {
      throw new Error(`DeepSeek chat ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as any;
    return (data?.choices?.[0]?.message?.content ?? "").trim();
  },
};
