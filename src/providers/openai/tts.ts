/**
 * OpenAI TTS — alternative to Minimax for English-leaning content.
 * Models: tts-1 (fast), tts-1-hd (higher quality).
 * Voices: alloy, echo, fable, onyx, nova, shimmer (6 system voices, no clone).
 *
 * Returns raw mp3 bytes from the response body (NOT JSON).
 */

import type { TtsClient } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";

const OPENAI_VOICES: Array<{ id: string; label: string; gender?: "male" | "female"; tags?: string[] }> = [
  { id: "alloy",   label: "Alloy",   tags: ["neutral", "balanced"] },
  { id: "echo",    label: "Echo",    gender: "male",   tags: ["narration"] },
  { id: "fable",   label: "Fable",   gender: "male",   tags: ["expressive", "story"] },
  { id: "onyx",    label: "Onyx",    gender: "male",   tags: ["deep", "calm"] },
  { id: "nova",    label: "Nova",    gender: "female", tags: ["warm"] },
  { id: "shimmer", label: "Shimmer", gender: "female", tags: ["bright"] },
];

export const openaiTts: TtsClient = {
  id: "openai",
  voices() {
    return OPENAI_VOICES;
  },
  async tts({ text, voiceId = "onyx", speed = 1.0, format = "mp3" }) {
    const cfg = loadProviderConfig("openai");
    const baseUrl = cfg.base_url || "https://api.openai.com/v1";
    const resp = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1-hd",
        input: text,
        voice: voiceId,
        response_format: format,
        speed,
      }),
    });
    if (!resp.ok) {
      throw new Error(`OpenAI tts ${resp.status}: ${await resp.text()}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  },
};
