/**
 * `pipeline say` — read ANY text aloud → one mp3. The standalone "配音工坊"
 * entry (no storyboard needed). Routes through the two-engine voice router:
 * Edge voice ids are free; `minimax:` ids are paid; `minimax:user_*` are clones.
 *
 *   pipeline say "你好世界" --voice zh-CN-XiaoxiaoNeural -o hello.mp3
 *   pipeline say --file script.txt --voice minimax:female-shaonv --emotion happy
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getTts } from "./providers/registry.ts";
import { touchVoice } from "./providers/minimax/voice-clone.ts";
import { cleanTtsText } from "./tts-clean.ts";

export interface SayOpts {
  text: string;
  outPath: string;
  voiceId: string;
  speed: number;
  emotion?: string;
  provider?: string;
}

export async function runSay(opts: SayOpts): Promise<{ outPath: string; engine: string; chars: number }> {
  const cleaned = cleanTtsText(opts.text);
  const client = getTts(opts.provider);
  const engine = opts.voiceId.startsWith("minimax:")
    ? "minimax"
    : /Neural$|^[a-z]{2}-[A-Z]{2}-/.test(opts.voiceId) ? "edge" : client.id;

  console.log(`[say] engine≈${engine}  voice=${opts.voiceId}  speed=${opts.speed}  ${cleaned.length} 字`);
  const audio = await client.tts({
    text: cleaned,
    voiceId: opts.voiceId,
    speed: opts.speed,
    emotion: opts.emotion,
  });
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  fs.writeFileSync(opts.outPath, audio);

  if (opts.voiceId.startsWith("minimax:user_")) touchVoice(opts.voiceId.slice("minimax:".length));

  console.log(`✓ ${(audio.length / 1024).toFixed(0)} KB → ${path.relative(process.cwd(), opts.outPath)}`);
  return { outPath: opts.outPath, engine, chars: cleaned.length };
}

/** Default output path when --out is omitted: output/say/<sha1>.mp3 */
export function defaultSayOut(root: string, text: string, voiceId: string): string {
  const h = crypto.createHash("sha1").update(`${text}|${voiceId}`).digest("hex").slice(0, 10);
  return path.join(root, "output", "say", `${h}.mp3`);
}
