/**
 * Minimax image generation — `image-01` and `image-01-live`.
 * Returns n PNG buffers (up to 9 per call).
 *
 * Endpoint: POST /v1/image_generation
 * Response: { data: { image_urls: string[] } } — we fetch each URL to bytes.
 */

import type { ImageClient } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";
import { withRetry } from "../retry.ts";

const ASPECT_MAP: Record<string, string> = {
  "16:9": "16:9",
  "9:16": "9:16",
  "1:1": "1:1",
  "4:3": "4:3",
  "3:4": "3:4",
};

export const minimaxImage: ImageClient = {
  id: "minimax",
  async image({ prompt, aspectRatio = "16:9", n = 1, style }) {
    const cfg = loadProviderConfig("minimax");
    const fullPrompt = style ? `${prompt}. Style: ${style}.` : prompt;

    const resp = await withRetry(() => fetch(`${cfg.base_url}/image_generation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "image-01",
        prompt: fullPrompt,
        aspect_ratio: ASPECT_MAP[aspectRatio] ?? "16:9",
        response_format: "url",
        n,
        // We pass a carefully-built English prompt with style + palette + negative
        // prompts already baked in. prompt_optimizer would rewrite it toward
        // Minimax's stock-tech aesthetic — exactly what we're trying to avoid.
        prompt_optimizer: false,
      }),
    }), { label: "minimax-image", maxAttempts: 3 });

    if (!resp.ok) {
      throw new Error(`Minimax image ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as any;
    if (data?.base_resp?.status_code !== 0) {
      throw new Error(
        `Minimax image failed: status=${data?.base_resp?.status_code} msg=${data?.base_resp?.status_msg}`
      );
    }
    const urls: string[] =
      data?.data?.image_urls ??
      (Array.isArray(data?.data) ? data.data.map((d: any) => d.url).filter(Boolean) : []);
    if (!urls.length) {
      throw new Error(`Minimax image: no urls in response: ${JSON.stringify(data).slice(0, 300)}`);
    }

    const buffers = await Promise.all(
      urls.map(async (u) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`Image fetch ${u} → HTTP ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      })
    );
    return buffers;
  },
};
