/**
 * macOS system TTS (`say`) — free, offline, no key. Last link of the tts fallback chain
 * (voice → edge → system), so the zero-key path still produces narration when Microsoft
 * rejects the Edge handshake. Placeholder quality (drafts / structure review), not final voice.
 *
 * Only voices that ship with macOS are used: several listed zh voices (Eddy, Flo, …) are
 * download-on-demand and silently render an empty file, so they are never picked by default.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TtsClient } from "../types.ts";

const SYSTEM_VOICES = [
  { id: "Tingting", label: "婷婷 · 女 · 普通话(macOS)", gender: "female" as const, tags: ["placeholder"] },
  { id: "Meijia", label: "美佳 · 女 · 台湾(macOS)", gender: "female" as const, tags: ["taiwan"] },
  { id: "Sinji", label: "善怡 · 女 · 粤语(macOS)", gender: "female" as const, tags: ["cantonese"] },
  { id: "Samantha", label: "Samantha · 女 · English(macOS)", gender: "female" as const, tags: ["english"] },
];

/** Map any pipeline voice id (Edge / MiniMax / say name) to a bundled macOS voice. */
export function resolveSystemVoice(voiceId?: string): string {
  const id = voiceId ?? "";
  const direct = SYSTEM_VOICES.find((v) => v.id.toLowerCase() === id.toLowerCase());
  if (direct) return direct.id;
  if (/^zh-TW/i.test(id)) return "Meijia";
  if (/^zh-HK|cantonese/i.test(id)) return "Sinji";
  if (/^en-/i.test(id) || /english/i.test(id)) return "Samantha";
  return "Tingting";
}

/** `say -r` is words per minute (~175 default); pipeline speed 1.0 = default. */
export function sayRate(speed?: number): number {
  return Math.round(175 * Math.min(2, Math.max(0.5, speed ?? 1)));
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.trim()}`))));
  });
}

export const systemTts: TtsClient = {
  id: "system",

  voices() {
    return SYSTEM_VOICES;
  },

  async tts(opts) {
    if (process.platform !== "darwin") throw new Error("系统配音(say)只在 macOS 上可用");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-say-"));
    try {
      const aiff = path.join(dir, "a.aiff");
      const mp3 = path.join(dir, "a.mp3");
      await run("say", ["-v", resolveSystemVoice(opts.voiceId), "-r", String(sayRate(opts.speed)), "-o", aiff, opts.text]);
      await run("ffmpeg", ["-v", "error", "-y", "-i", aiff, "-ar", "44100", "-ac", "2", "-b:a", "128k", mp3]);
      const buf = fs.readFileSync(mp3);
      // An undownloaded voice yields a ~header-only file; fail loudly instead of shipping silence.
      if (buf.length < 2000) throw new Error("系统配音输出为空(该音色可能未下载)");
      return buf;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
};
