/**
 * Delivery promise — the "contract" a storyboard makes about the final video,
 * locked at APPROVAL time and checked after render.
 *
 * The QA self-review (review.ts) inspects the finished mp4, but it can only see
 * what's ON DISK at review time — so a TTS run that failed (or was never run)
 * makes a silent slideshow look "correct", and a scene silently dropped at
 * render (method removed) just makes a shorter video with no complaint. This
 * captures the intent at the moment the user approves, so review can flag any
 * silent downgrade instead of blessing it.
 *
 * Clean-room + MIT, inspired by OpenMontage's delivery_promise (AGPL) —
 * reimplemented minimally for Vedio Make: no state machine, no checkpoints, just
 * a lightweight lock + a post-render diff surfaced as warnings.
 */
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./fsutil.ts";
import { resolveDesign } from "./methods/designs.ts";
import type { Storyboard } from "./types.ts";

export interface DeliveryPromise {
  lockedAt: string;
  sceneCount: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  designId: string;
  audio: { voice: boolean; bgm: boolean };
  scenes: Array<{ index: number; method: string | null }>;
}

/** Everything the promise records is derivable from the storyboard + output dir. */
export function buildPromise(sb: Storyboard, outputDir: string): DeliveryPromise {
  return {
    lockedAt: new Date().toISOString(),
    sceneCount: sb.scenes.length,
    durationSec: Math.round(sb.scenes.reduce((a, s) => a + (s.durationSec || 0), 0) * 100) / 100,
    width: sb.project.width,
    height: sb.project.height,
    fps: sb.project.fps,
    designId: resolveDesign(sb.project.design).__presetId,
    // Audio is "promised" when its source artifact exists at lock time — i.e. the
    // user has run `tts` / `bgm`. A later render that drops the mix then betrays
    // this promise instead of quietly shipping a silent film.
    audio: {
      voice: fs.existsSync(path.join(outputDir, "voice-track.json")),
      bgm: fs.existsSync(path.join(outputDir, "bgm.mp3")),
    },
    scenes: sb.scenes.map((s) => ({ index: s.index, method: s.method ?? null })),
  };
}

/** Lock the promise to output/promise.json (atomic). Re-approving overwrites. */
export function lockPromise(sb: Storyboard, outputDir: string): DeliveryPromise {
  const promise = buildPromise(sb, outputDir);
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    writeFileAtomic(path.join(outputDir, "promise.json"), JSON.stringify(promise, null, 2));
  } catch { /* a promise-write hiccup must never block approval */ }
  return promise;
}

export function loadPromise(outputDir: string): DeliveryPromise | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(outputDir, "promise.json"), "utf8")) as DeliveryPromise;
  } catch {
    return null;
  }
}

/**
 * Diff the delivered storyboard against its locked promise. Returns human-facing
 * warning lines (empty when the delivery honors the promise). Kept aesthetic- and
 * engine-neutral: it reports what CHANGED since approval, not opinions about it.
 */
export function diffPromise(promise: DeliveryPromise, sb: Storyboard): string[] {
  const out: string[] = [];
  if (sb.scenes.length !== promise.sceneCount) {
    out.push(`镜头数变了:承诺 ${promise.sceneCount} 个,实际 ${sb.scenes.length} 个(确认后增删过镜头)`);
  }
  const nowDesign = resolveDesign(sb.project.design).__presetId;
  if (nowDesign !== promise.designId) {
    out.push(`设计风格变了:承诺 '${promise.designId}',实际 '${nowDesign}'`);
  }
  if (sb.project.width !== promise.width || sb.project.height !== promise.height) {
    out.push(`分辨率变了:承诺 ${promise.width}×${promise.height},实际 ${sb.project.width}×${sb.project.height}`);
  }
  // Per-scene method drift — a scene whose method changed (or was cleared, so
  // render silently skips it) after approval.
  const nowByIdx = new Map(sb.scenes.map((s) => [s.index, s.method ?? null]));
  for (const p of promise.scenes) {
    if (!nowByIdx.has(p.index)) {
      out.push(`承诺的镜头 #${p.index} 已不在成片里`);
    } else {
      const now = nowByIdx.get(p.index);
      if (now !== p.method) out.push(`镜头 #${p.index} 方法变了:承诺 '${p.method ?? "(空)"}',实际 '${now ?? "(空)"}'`);
    }
  }
  return out;
}
