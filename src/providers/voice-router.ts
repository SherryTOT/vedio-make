/**
 * Two-engine TTS router (§1/§4.2 of the port spec).
 *
 * Routes by VOICE-ID PREFIX so callers never pick an engine:
 *   - `minimax:<id>`  → MiniMax T2A (paid; cloned voices are `minimax:user_*`)
 *   - everything else → Edge "read aloud" (free, no key)
 *   - bare legacy ids (e.g. `presenter_male`) → MiniMax, for back-compat with
 *     the pipeline's existing `tts` default voice.
 *
 * voices() aggregates all three groups (Edge / MiniMax system / user clones)
 * with a `group` tag so a UI can section them. Registered as provider `voice`
 * and used as the default TTS provider — `pipeline tts`/`say` route automatically.
 */
import type { TtsClient } from "./types.ts";
import { edgeTts } from "./edge/tts.ts";
import { minimaxTts } from "./minimax/tts.ts";
import { listVoices as listClones, voiceStatus } from "./minimax/voice-clone.ts";

const MINIMAX_PREFIX = "minimax:";

/** Looks like an Edge voice id, e.g. "zh-CN-XiaoxiaoNeural" / "en-US-GuyNeural". */
function looksEdge(voiceId: string): boolean {
  return /Neural$/.test(voiceId) || /^[a-z]{2}-[A-Z]{2}-/.test(voiceId);
}

export interface GroupedVoice {
  id: string;
  label: string;
  gender?: "male" | "female";
  tags?: string[];
  group: "edge" | "minimax" | "minimax_clone";
}

export const voiceRouter: TtsClient & {
  groupedVoices(): GroupedVoice[];
} = {
  id: "voice",

  voices() {
    // Flat list (TtsClient contract). Edge bare + MiniMax prefixed.
    return [
      ...edgeTts.voices(),
      ...minimaxTts.voices().map((v) => ({ ...v, id: MINIMAX_PREFIX + v.id })),
    ];
  },

  groupedVoices() {
    const edge: GroupedVoice[] = edgeTts.voices().map((v) => ({ ...v, group: "edge" as const }));
    const mm: GroupedVoice[] = minimaxTts.voices().map((v) => ({
      ...v, id: MINIMAX_PREFIX + v.id, group: "minimax" as const,
    }));
    const clones: GroupedVoice[] = listClones().map((c) => {
      const st = voiceStatus(c);
      const suffix =
        st.state === "permanent" ? " · 永久"
        : st.state === "expired" ? " · 已过期"
        : ` · 试用剩 ${Math.floor((st.remainingSec ?? 0) / 3600)}h`;
      return {
        id: MINIMAX_PREFIX + c.voice_id,
        label: c.label + suffix,
        group: "minimax_clone" as const,
        tags: ["clone"],
      };
    });
    return [...edge, ...mm, ...clones];
  },

  async tts(opts) {
    const voiceId = opts.voiceId ?? "";
    if (voiceId.startsWith(MINIMAX_PREFIX)) {
      return minimaxTts.tts({ ...opts, voiceId: voiceId.slice(MINIMAX_PREFIX.length) });
    }
    if (looksEdge(voiceId)) {
      return edgeTts.tts(opts);
    }
    // bare legacy id (e.g. "presenter_male") → MiniMax for back-compat.
    return minimaxTts.tts(opts);
  },
};
