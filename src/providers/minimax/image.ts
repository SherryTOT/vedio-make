/**
 * Minimax image generation — `image-01` and `image-01-live`.
 * Returns n PNG buffers (up to 9 per call).
 *
 * Endpoint: POST /v1/image_generation
 * Response: { data: { image_urls: string[] } } — we fetch each URL to bytes.
 */

import type { ImageClient } from "../types.ts";
import { loadProviderConfig, fetchT } from "../shared.ts";
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

    // HTTP 429/5xx and soft busy-codes resolve as a completed response, so they
    // must be thrown from INSIDE the retried closure for isRetryable to back off
    // and retry them (previously they were thrown after withRetry → never retried).
    const data = await withRetry(async () => {
      const r = await fetchT(`${cfg.base_url}/image_generation`, {
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
      });
      if (!r.ok) {
        // Status in the message → isRetryable retries 429/5xx, aborts 4xx.
        throw new Error(`Minimax image ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
      const d = (await r.json()) as any;
      const c = d?.base_resp?.status_code;
      if (c === 1002 || c === 1004 || c === 1027 || c === 1039) {
        throw new Error(`Minimax image busy status=${c}: ${d?.base_resp?.status_msg}`);
      }
      if (c !== 0) {
        throw new Error(`Minimax image failed: status=${c} msg=${d?.base_resp?.status_msg}`);
      }
      return d;
    }, { label: "minimax-image", maxAttempts: 3 });
    const urls: string[] =
      data?.data?.image_urls ??
      (Array.isArray(data?.data) ? data.data.map((d: any) => d.url).filter(Boolean) : []);
    if (!urls.length) {
      throw new Error(`Minimax image: no urls in response: ${JSON.stringify(data).slice(0, 300)}`);
    }

    const buffers = await Promise.all(
      urls.map(async (u) => {
        const r = await fetchT(u);
        if (!r.ok) throw new Error(`Image fetch ${u} → HTTP ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      })
    );
    return buffers;
  },
};
