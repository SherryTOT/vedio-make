/**
 * Minimax chat completion — OpenAI-compatible.
 * Strips <think>...</think> reasoning blocks emitted by M2.x models.
 */

import type { ChatClient, ChatMessage } from "../types.ts";
import { loadProviderConfig, fetchT } from "../shared.ts";
import { withRetry } from "../retry.ts";

export const minimaxChat: ChatClient = {
  id: "minimax",
  async chat({ messages, maxTokens = 4096, temperature = 0.3, model }) {
    return withRetry(() => doChat({ messages, maxTokens, temperature, model }), { label: "minimax-chat" });
  },
};

async function doChat({ messages, maxTokens, temperature, model }: { messages: ChatMessage[]; maxTokens: number; temperature: number; model?: string }): Promise<string> {
    const cfg = loadProviderConfig("minimax");
    const resp = await fetchT(`${cfg.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model ?? cfg.model ?? "MiniMax-M2.7-highspeed",
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Minimax chat ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as any;
    let content: string = data?.choices?.[0]?.message?.content ?? "";
    content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    return content;
}
