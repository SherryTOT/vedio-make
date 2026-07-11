/**
 * MyTokk (中转) image generation via the OpenAI **Responses API** image tool.
 *
 * MyTokk's GPT keys (group codex-*) do NOT expose /v1/images/generations —
 * that returns "no available channel". Instead gpt-5.5 generates images through
 * the Responses API's built-in `image_generation` tool:
 *   POST {base}/responses  { model, input, tools:[{type:"image_generation", …}] }
 *   → output[].type == "image_generation_call", .result = base64 PNG
 *
 * NOTE on transparency: the tool's `background:"transparent"` option is flaky on
 * this 中转 — it forces `input` to be a message list, and the model then reasons
 * instead of emitting the image (tool_choice isn't honoured). So we always
 * generate on a plain background (string input, reliable) and matte-cut the
 * white separately (src/matte.ts → `pipeline stickers`), as the brief intended.
 */

import type { ImageClient } from "../types.ts";
import { loadProviderConfig, fetchT } from "../shared.ts";
import { withRetry } from "../retry.ts";

const SIZE_FOR_RATIO: Record<string, string> = {
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "1:1":  "1024x1024",
  "4:3":  "1536x1024",
  "3:4":  "1024x1536",
};

export const mytokkImage: ImageClient = {
  id: "mytokk",
  async image({ prompt, aspectRatio = "16:9", n = 1, style }) {
    const cfg = loadProviderConfig("mytokk");
    const base = cfg.base_url || "https://mytokk.com/v1";
    const model = cfg.model || "gpt-5.5";
    const size = SIZE_FOR_RATIO[aspectRatio] ?? "1024x1024";
    const fullPrompt = style ? `${prompt}. Style: ${style}.` : prompt;
    const tool = { type: "image_generation", size };

    const genOne = () =>
      withRetry(async () => {
        const r = await fetchT(`${base}/responses`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.api_key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: fullPrompt, tools: [tool] }),
        }, 240_000);
        if (!r.ok) {
          // Status in the message → isRetryable retries 429/5xx, aborts 4xx.
          throw new Error(`MyTokk image ${r.status}: ${(await r.text()).slice(0, 200)}`);
        }
        const j = (await r.json()) as any;
        const call = (j?.output ?? []).find((o: any) => o.type === "image_generation_call");
        const b64 = call?.result;
        if (!b64) {
          throw new Error(`MyTokk image: no image_generation_call.result in response: ${JSON.stringify(j).slice(0, 220)}`);
        }
        const buf = Buffer.from(b64, "base64");
        // Reject an error page saved as a .png: PNG (89 50) / JPEG (FF D8) magic.
        const okMagic = (buf[0] === 0x89 && buf[1] === 0x50) || (buf[0] === 0xff && buf[1] === 0xd8);
        if (!okMagic) throw new Error(`MyTokk image returned non-image bytes (${buf.length}B)`);
        return buf;
      }, { label: "mytokk-image", maxAttempts: 3 });

    const out: Buffer[] = [];
    for (let i = 0; i < n; i++) out.push(await genOne());
    return out;
  },
};
