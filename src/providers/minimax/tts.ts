/**
 * Minimax TTS via /v1/t2a_v2 with model fallback chain.
 *
 * Why the chain: Token Plan keys (sk-cp-*) only cover the newest generation.
 * Older models return business code 2056 / 2061 even though they "exist".
 * Recipe lifted from Restate (server/app.py:2025).
 */

import type { TtsClient } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";
import { withRetry } from "../retry.ts";

const TTS_MODEL_CHAIN = [
  "speech-2.8-hd",
  "speech-2.8-turbo",
  "speech-2.6-hd",
  "speech-2.6-turbo",
  "speech-02-hd",
  "speech-02-turbo",
  "speech-01-hd",
  "speech-01-turbo",
];

/** Curated voice list — Minimax has many more; these are the cleanest for narration. */
const MINIMAX_VOICES: Array<{
  id: string;
  label: string;
  gender?: "male" | "female";
  tags?: string[];
}> = [
  { id: "presenter_male",   label: "主持人男声",     gender: "male",   tags: ["narration", "podcast"] },
  { id: "presenter_female", label: "主持人女声",     gender: "female", tags: ["narration", "podcast"] },
  { id: "male-qn-qingse",   label: "青年男声 · 青色", gender: "male",   tags: ["young"] },
  { id: "male-qn-jingying", label: "精英男声",       gender: "male",   tags: ["business"] },
  { id: "female-shaonv",    label: "少女音",         gender: "female", tags: ["young", "bright"] },
  { id: "female-yujie",     label: "御姐音",         gender: "female", tags: ["mature"] },
  { id: "female-chengshu",  label: "成熟女声",       gender: "female", tags: ["mature", "warm"] },
  { id: "audiobook_male_1", label: "有声书男声 1",   gender: "male",   tags: ["narration", "deep"] },
  { id: "audiobook_female_1", label: "有声书女声 1", gender: "female", tags: ["narration"] },
  { id: "Chinese (Mandarin)_Stubborn_Friend", label: "倔强朋友(中)", gender: "male", tags: ["casual"] },
];

export const minimaxTts: TtsClient = {
  id: "minimax",

  voices() {
    return MINIMAX_VOICES;
  },

  async tts(opts) {
    const cfg = loadProviderConfig("minimax");
    // HTTPS enforcement: base_url is user-editable; a plain-http endpoint would
    // leak the Bearer key on the wire. Refuse to downgrade (localhost exempt).
    if (cfg.base_url && !/^https:/i.test(cfg.base_url) && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(cfg.base_url)) {
      throw new Error(`Minimax tts refused: base_url must be https (got '${cfg.base_url}') — would leak the API key.`);
    }
    let lastError: { code: number; msg: string } | null = null;

    // Emotion whitelist — silently drop illegal values (don't fail the request).
    const EMO = new Set(["neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised"]);
    const emotion = opts.emotion && EMO.has(opts.emotion) ? opts.emotion : undefined;

    for (const model of TTS_MODEL_CHAIN) {
      const voiceSetting: Record<string, unknown> = {
        voice_id: opts.voiceId ?? "presenter_male",
        speed: opts.speed ?? 1.0,
        vol: opts.vol ?? 1.0,
        pitch: opts.pitch ?? 0,
        english_normalization: opts.englishNormalization ?? false,
      };
      if (emotion) voiceSetting.emotion = emotion;
      const payload: Record<string, unknown> = {
        model,
        text: opts.text,
        stream: false,
        voice_setting: voiceSetting,
        audio_setting: {
          sample_rate: opts.sampleRate ?? 32000,
          bitrate: opts.bitrate ?? 128000,
          format: opts.format ?? "mp3",
          channel: 1,
        },
      };
      if (opts.languageBoost) payload.language_boost = opts.languageBoost;
      let resp: Response;
      try {
        // Retry transient network errors; non-transient errors fall through to model-chain fallback.
        resp = await withRetry(() => fetch(`${cfg.base_url}/t2a_v2`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }), { label: `minimax-tts-${model}`, maxAttempts: 3 });
      } catch (e) {
        lastError = { code: -1, msg: (e as Error).message };
        continue;
      }
      if (!resp.ok) {
        lastError = { code: resp.status, msg: await resp.text() };
        continue;
      }
      const data = (await resp.json()) as any;
      const code: number = data?.base_resp?.status_code ?? -1;
      const msg: string = data?.base_resp?.status_msg ?? "";
      if (code === 0) {
        const audioHex: string = data?.data?.audio ?? "";
        if (!audioHex) {
          lastError = { code: -1, msg: "empty audio in response" };
          continue;
        }
        return Buffer.from(audioHex, "hex");
      }
      lastError = { code, msg };
      if (code !== 2061 && code !== 2056) {
        throw new Error(`Minimax tts non-tier error: code=${code} msg=${msg}`);
      }
    }
    throw new Error(
      `Minimax tts: all ${TTS_MODEL_CHAIN.length} model fallbacks exhausted. Last: code=${lastError?.code} msg=${lastError?.msg}`
    );
  },
};
