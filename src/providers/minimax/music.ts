/**
 * Minimax music gen v2.6.
 */

import type { MusicClient } from "../types.ts";
import { loadProviderConfig, fetchT } from "../shared.ts";

export const minimaxMusic: MusicClient = {
  id: "minimax",
  async music({ prompt, lyrics, format = "mp3" }) {
    const cfg = loadProviderConfig("minimax");
    const resp = await fetchT(`${cfg.base_url}/music_generation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "music-2.6",
        prompt,
        lyrics: lyrics ?? "##\n##",
        audio_setting: { sample_rate: 44100, bitrate: 256000, format },
      }),
    });
    if (!resp.ok) {
      throw new Error(`Minimax music ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as any;
    if (data?.base_resp?.status_code !== 0) {
      throw new Error(
        `Minimax music failed: status=${data?.base_resp?.status_code} msg=${data?.base_resp?.status_msg}`
      );
    }
    const audioHex: string = data?.data?.audio ?? "";
    if (!audioHex) throw new Error(`Minimax music: empty audio`);
    return [Buffer.from(audioHex, "hex")][0];
  },
};
