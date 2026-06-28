/**
 * OpenAI image gen — DALL-E 3 / GPT-Image-1.
 * Note: GPT-Image-1 accepts only 1024×1024 / 1024×1536 / 1536×1024 sizes,
 * so the aspect ratio is mapped to the closest of those.
 */

import type { ImageClient } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";

const SIZE_FOR_RATIO: Record<string, string> = {
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "1:1":  "1024x1024",
  "4:3":  "1536x1024",
  "3:4":  "1024x1536",
};

export const openaiImage: ImageClient = {
  id: "openai",
  async image({ prompt, aspectRatio = "16:9", n = 1, style }) {
    const cfg = loadProviderConfig("openai");
    const baseUrl = cfg.base_url || "https://api.openai.com/v1";
    const fullPrompt = style ? `${prompt}. Style: ${style}.` : prompt;

    const resp = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: fullPrompt,
        n,
        size: SIZE_FOR_RATIO[aspectRatio] ?? "1536x1024",
      }),
    });
    if (!resp.ok) {
      throw new Error(`OpenAI image ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as any;
    const items = data?.data ?? [];
    const buffers = await Promise.all(
      items.map(async (item: any) => {
        if (item.b64_json) return Buffer.from(item.b64_json, "base64");
        if (item.url) {
          const r = await fetch(item.url);
          return Buffer.from(await r.arrayBuffer());
        }
        throw new Error("OpenAI image: response has neither b64_json nor url");
      })
    );
    return buffers;
  },
};
