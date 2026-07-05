/**
 * `pipeline tts` — for each scene in storyboard.json, call Minimax TTS to
 * generate a voiceover mp3. Writes:
 *   output/voice/scene-NNN.mp3        one mp3 per scene
 *   output/voice-track.json           timing manifest (start, duration, file)
 *
 * Caches by scene text hash — re-runs only regenerate mp3s for changed scenes.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { getTts, withFallback, fallbackChain } from "./providers/registry.ts";
import { logDecision } from "./decisions.ts";
import { touchVoice } from "./providers/minimax/voice-clone.ts";
import { writeFileAtomic } from "./fsutil.ts";
import type { Storyboard } from "./types.ts";

/** Measure mp3 duration via ffprobe. Returns seconds, or null if probe fails. */
function probeDurationSec(filePath: string): number | null {
  const r = spawnSync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) return null;
  const v = parseFloat((r.stdout || "").trim());
  return Number.isFinite(v) ? v : null;
}

export interface VoiceEntry {
  index: number;
  startSec: number;
  durationSec: number;
  text: string;
  file: string;          // relative to project root
  textHash: string;      // sha1(text + voiceId) — drives cache invalidation
  /** Provider id that ACTUALLY produced this mp3 (may be a fallback, e.g. "edge"
   *  after the primary "voice" router failed). A cache entry whose engine no
   *  longer matches the resolvable primary is treated as a miss so a transient
   *  downgrade never gets frozen in. */
  engineId?: string;
  /** Actual mp3 duration (from ffprobe). Populated when probe succeeds. */
  audioDurationSec?: number;
  /** TTS speed actually used (may differ from caller's request after fit-retry). */
  usedSpeed?: number;
}

export interface VoiceTrack {
  provider: string;
  voiceId: string;
  speed: number;
  scenes: VoiceEntry[];
  totalSec: number;
}

interface TtsOpts {
  storyboardPath: string;
  voiceDir: string;
  trackPath: string;
  projectRoot: string;
  voiceId: string;
  speed: number;
  force: boolean;
  /** Provider id; defaults to "minimax" (or PIPELINE_TTS_PROVIDER env). */
  provider?: string;
}

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

function stripSrtArtifacts(text: string): string {
  // ASR sometimes leaves cue numbers / time markers in text. Just safety.
  return text.replace(/^\d+$/m, "").trim();
}

export async function runTts(opts: TtsOpts): Promise<VoiceTrack> {
  const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
  fs.mkdirSync(opts.voiceDir, { recursive: true });
  const ttsClient = getTts(opts.provider);
  console.log(`[tts] provider=${ttsClient.id}  voice=${opts.voiceId}  speed=${opts.speed}`);

  // Fallback-aware synth: if the chosen provider fails (missing key / network),
  // walk the fallback chain (…→ Edge, which is free + keyless) and log the
  // downgrade to output/decisions.json.
  const outputDir = path.dirname(opts.trackPath);
  // The primary (chain-head) engine we WANT every mp3 to come from. If synthesis
  // had to walk down the fallback chain, the entry records the actual engine so a
  // later run (with the primary healthy again) regenerates instead of caching the
  // degraded audio forever.
  const primaryEngine = fallbackChain("tts", opts.provider)[0];
  const synth = async (o: { text: string; voiceId?: string; speed?: number }, sceneIdx: number): Promise<{ audio: Buffer; engineId: string }> => {
    let engineId = primaryEngine;
    const audio = await withFallback(
      "tts", opts.provider, getTts,
      (c, id) => { engineId = id; return c.tts(o); },
      (from, to, err) => {
        console.warn(`   ↪ [scene ${sceneIdx}] tts provider '${from}' 失败(${err.message.slice(0, 60)})— 回退到 '${to}'`);
        logDecision(outputDir, {
          stage: "tts", category: "provider-fallback", subject: `场景 #${sceneIdx} 配音`,
          selected: to, options: [from, to], reason: `${from} 失败:${err.message.slice(0, 80)}`, confidence: "high",
        });
      },
    );
    return { audio, engineId };
  };

  const entries: VoiceEntry[] = [];

  // Load existing track for cache lookup
  let existing: VoiceTrack | null = null;
  if (fs.existsSync(opts.trackPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(opts.trackPath, "utf8"));
    } catch {}
  }
  const existingByIdx = new Map<number, VoiceEntry>();
  if (existing) for (const e of existing.scenes) existingByIdx.set(e.index, e);

  for (const sc of sb.scenes) {
    const text = stripSrtArtifacts(sc.text);
    // Scene-level voice override (set by analyzer for dialog variety) wins.
    const effectiveVoice = sc.voice || opts.voiceId;
    const hash = sha1(`${text}|${ttsClient.id}|${effectiveVoice}|${opts.speed}`);
    const filename = `scene-${String(sc.index).padStart(3, "0")}.mp3`;
    const absPath = path.join(opts.voiceDir, filename);
    const relPath = path.relative(opts.projectRoot, absPath);

    const cached = existingByIdx.get(sc.index);
    // A cache entry is only reusable if its recorded engine still matches the
    // resolvable primary. `engineId === undefined` = legacy track (pre-fix) —
    // trusted, not force-regenerated. A recorded fallback engine (e.g. "edge")
    // that differs from the now-healthy primary is a miss → regenerate.
    const engineOk = cached?.engineId === undefined || cached.engineId === primaryEngine;
    if (!opts.force && cached?.textHash === hash && engineOk && fs.existsSync(absPath)) {
      console.log(`[scene ${sc.index}] tts cache hit — '${text.slice(0, 28)}…'`);
      entries.push(cached);
      continue;
    }
    if (cached?.textHash === hash && !engineOk) {
      console.log(`[scene ${sc.index}] 上次配音由回退引擎 '${cached.engineId}' 生成、主引擎 '${primaryEngine}' 已可用 — 重新生成`);
    }

    const voiceLabel = effectiveVoice === opts.voiceId ? "" : ` [voice=${effectiveVoice}]`;
    console.log(`[scene ${sc.index}] tts → ${filename}${voiceLabel}  '${text.slice(0, 36)}${text.length > 36 ? "…" : ""}'`);
    try {
      // First pass at requested speed
      let { audio, engineId } = await synth({ text, voiceId: effectiveVoice, speed: opts.speed }, sc.index);
      writeFileAtomic(absPath, audio);

      // Adaptive-speed retry: if the spoken audio overflows the scene window,
      // recompute a speed that fits (with 0.2s tail margin) and re-render.
      // Clamped to [0.85, 1.5] — outside that range the voice becomes unnatural.
      const sceneBudget = Math.max(0.5, sc.durationSec - 0.2);
      let measured = probeDurationSec(absPath);
      let usedSpeed = opts.speed;
      if (measured && measured > sceneBudget) {
        const fitSpeed = Math.min(1.5, Math.max(opts.speed, opts.speed * (measured / sceneBudget)));
        if (Math.abs(fitSpeed - opts.speed) > 0.05) {
          console.log(
            `   ↪ tts ${measured.toFixed(2)}s overflows ${sceneBudget.toFixed(2)}s window — retrying at speed=${fitSpeed.toFixed(2)}`
          );
          try {
            const retry = await synth({ text, voiceId: effectiveVoice, speed: fitSpeed }, sc.index);
            audio = retry.audio;
            engineId = retry.engineId;
            writeFileAtomic(absPath, audio);
            measured = probeDurationSec(absPath);
            usedSpeed = fitSpeed;
          } catch (e) {
            console.warn(`   ↪ retry failed (${(e as Error).message}); keeping first pass`);
          }
        }
        if (measured && measured > sc.durationSec) {
          console.warn(
            `   ⚠ scene ${sc.index} still overflows at speed=${usedSpeed.toFixed(2)} (${measured.toFixed(2)}s > ${sc.durationSec.toFixed(2)}s). Voice will bleed into next scene.`
          );
        }
      }

      entries.push({
        index: sc.index,
        startSec: sc.startSec,
        durationSec: sc.durationSec,
        text,
        file: relPath,
        textHash: hash,
        engineId,
        audioDurationSec: measured ?? undefined,
        usedSpeed,
      } as VoiceEntry);

      // §6 168h rule: a successful synth flips a cloned voice permanent.
      // No-op for non-cloned ids (touchVoice only matches the local store).
      if (effectiveVoice.startsWith("minimax:user_")) {
        touchVoice(effectiveVoice.slice("minimax:".length));
      }
    } catch (e) {
      console.error(`[scene ${sc.index}] tts FAILED: ${(e as Error).message}`);
      throw e;
    }
  }

  const track: VoiceTrack = {
    provider: ttsClient.id,
    voiceId: opts.voiceId,
    speed: opts.speed,
    scenes: entries,
    totalSec: sb.scenes.at(-1)?.endSec ?? 0,
  };
  fs.writeFileSync(opts.trackPath, JSON.stringify(track, null, 2));
  console.log(`✓ ${entries.length} voice mp3 → ${path.relative(process.cwd(), opts.voiceDir)}`);
  console.log(`✓ track manifest → ${path.relative(process.cwd(), opts.trackPath)}`);
  return track;
}
