/**
 * `pipeline bgm` — generates ONE background music mp3 covering the whole video
 * via Minimax music gen v2.6. The prompt is derived from the project title and
 * the catalog of methods used (so a data-heavy video gets a "calm tech" vibe vs
 * a hero-heavy montage getting a more cinematic vibe).
 *
 * Output: output/bgm.mp3
 * Caches by (title + total duration + methods hash). Single API call.
 *
 * Minimax v2.6 currently returns a fixed-length clip (60-90s typical). For
 * longer videos, the renderer's mix step will trim/loop.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getMusic } from "./providers/registry.ts";
import type { Storyboard } from "./types.ts";

interface BgmOpts {
  storyboardPath: string;
  outPath: string;
  /** Override generated prompt; if provided, used verbatim */
  promptOverride?: string;
  force: boolean;
  provider?: string;
}

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

/** Derives a music prompt from storyboard semantics. */
function derivePrompt(sb: Storyboard): string {
  const methods = sb.scenes.map((s) => s.method ?? "").filter(Boolean);
  const hasData = methods.some((m) => m.includes("d3"));
  const hasCards = methods.some((m) => m.includes("card") || m.includes("framer"));
  const hasKinetic = methods.some((m) => m.includes("kinetic"));
  const hasList = methods.some((m) => m.includes("scatter"));

  const vibes: string[] = [];
  if (hasData) vibes.push("calm tech podcast underscore, subtle synth pads");
  if (hasKinetic) vibes.push("confident punchy intro vibe");
  if (hasCards) vibes.push("clean product-demo cadence");
  if (hasList) vibes.push("light building energy");
  if (vibes.length === 0) vibes.push("ambient instrumental");

  return [
    `Instrumental background music for a video titled "${sb.project.title}".`,
    "Genre: subtle electronic, modern Chinese tech / business explainer.",
    `Mood: ${vibes.join(", ")}.`,
    "BPM: 80-100. No vocals. Should not compete with a spoken narration on top.",
    "Pleasant low-mid mix, slightly compressed, mastered for under-voice use.",
  ].join(" ");
}

export async function runBgm(opts: BgmOpts): Promise<{ path: string; prompt: string }> {
  const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
  const prompt = opts.promptOverride || derivePrompt(sb);
  const totalSec = sb.scenes.at(-1)?.endSec ?? 60;

  const cacheKey = sha1(`${prompt}|${totalSec.toFixed(0)}`);
  const cachePath = path.join(path.dirname(opts.outPath), `.bgm-cache-${cacheKey}.mp3`);

  if (!opts.force && fs.existsSync(cachePath)) {
    fs.copyFileSync(cachePath, opts.outPath);
    console.log(`[bgm] cache hit — copied ${path.basename(cachePath)} → ${path.basename(opts.outPath)}`);
    return { path: opts.outPath, prompt };
  }

  const musicClient = getMusic(opts.provider);
  console.log(`[bgm] provider=${musicClient.id}`);
  console.log(`[bgm] prompt: ${prompt.slice(0, 80)}…`);
  const audio = await musicClient.music({ prompt, lyrics: "##\n##" });
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  fs.writeFileSync(opts.outPath, audio);
  fs.writeFileSync(cachePath, audio); // cache for next run
  console.log(`✓ bgm mp3 → ${path.relative(process.cwd(), opts.outPath)}  (${(audio.length / 1024).toFixed(0)} KB)`);
  return { path: opts.outPath, prompt };
}
