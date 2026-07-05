/**
 * `pipeline plan <subtitles.srt>` — parses the SRT and writes a skeleton
 * storyboard.json with one scene per cue, all method fields = null.
 *
 * After this runs, Claude (in chat) reads:
 *   - methods/catalog.json
 *   - design.md
 *   - assets/ folder listing
 *   - this skeleton storyboard.json
 *
 * Then Claude fills in method / fallback / reasoning / assets / notes for each
 * scene, and runs `pipeline storyboard` to generate the HTML preview.
 */

import fs from "node:fs";
import path from "node:path";
import { parseSrt } from "./srt.ts";
import type { Cue, Scene, Storyboard } from "./types.ts";

interface PlanOptions {
  /** Path to SRT file */
  srtPath: string;
  /** Path to output storyboard.json */
  outPath: string;
  /** Path to design.md (relative to project root, just stored as metadata) */
  designDoc: string;
  /** Path to assets/ folder to scan */
  assetsDir: string;
  /** Project title */
  title: string;
  /** Frame size */
  width: number;
  height: number;
  fps: number;
  /** Overwrite an existing storyboard even if it already has real work. */
  force?: boolean;
}

function cueToScene(cue: Cue, index: number): Scene {
  return {
    index,
    cues: [cue],
    startSec: cue.startSec,
    endSec: cue.endSec,
    durationSec: +(cue.endSec - cue.startSec).toFixed(3),
    text: cue.text,
    method: null,
    fallback: null,
    reasoning: null,
    assets: [],
    notes: [],
  };
}

/** Join cue texts with a space only across a latin word boundary (CJK joins flush). */
function joinCueText(cues: Cue[]): string {
  let out = "";
  for (const c of cues) {
    const t = (c.text ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (out && /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(t)) out += " ";
    out += t;
  }
  return out;
}

/**
 * Greedy cue merge for ASR-style SRTs (word-level cues ~0.5s each). Accumulates
 * consecutive cues into a scene until it's long enough AND ends on a sentence
 * terminator, or it hits the max length, or a real pause opens before the next
 * cue. A normal sentence-per-cue SRT is untouched (each cue already ends a
 * sentence, so every group flushes at size 1). Exported for unit tests.
 */
export function mergeCues(cues: Cue[], minSec = 2.0, maxSec = 8, gapSec = 1.0): Cue[] {
  const endsSentence = (t: string) => /[。．.!?！？；;”"))\]】]\s*$/.test((t ?? "").trim());
  const merged: Cue[] = [];
  let group: Cue[] = [];
  const flush = () => {
    if (!group.length) return;
    merged.push({
      index: merged.length + 1,
      startSec: group[0].startSec,
      endSec: group[group.length - 1].endSec,
      text: joinCueText(group),
    });
    group = [];
  };
  for (let i = 0; i < cues.length; i++) {
    group.push(cues[i]);
    const dur = group[group.length - 1].endSec - group[0].startSec;
    const next = cues[i + 1];
    const gapToNext = next ? next.startSec - cues[i].endSec : Infinity;
    if (dur >= maxSec || gapToNext > gapSec || (dur >= minSec && endsSentence(cues[i].text))) flush();
  }
  flush();
  return merged;
}

/** Detect ASR-style SRT (many very short cues) so merging only kicks in there. */
function looksAsr(cues: Cue[]): boolean {
  if (cues.length < 4) return false;
  const durs = cues.map((c) => c.endSec - c.startSec).sort((a, b) => a - b);
  const median = durs[Math.floor(durs.length / 2)] ?? 0;
  return median < 1.8;
}

function listAssets(assetsDir: string): string[] {
  if (!fs.existsSync(assetsDir)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(assetsDir, "");
  return out.sort();
}

export function runPlan(opts: PlanOptions): Storyboard {
  // Guard against silently clobbering real work: re-running plan over a storyboard
  // that's already analyzed / rendered / method-assigned would wipe those choices,
  // the design selection, and manual edits. Refuse unless force.
  if (!opts.force && fs.existsSync(opts.outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(opts.outPath, "utf8"));
      const hasWork = existing?.stages?.analyzed || existing?.stages?.rendered ||
        (Array.isArray(existing?.scenes) && existing.scenes.some((s: any) => s.method));
      if (hasWork) {
        throw new Error(
          `${opts.outPath} 已存在且含分析/渲染/方法选择 —— plan 会覆盖它并丢失现有 method/design/编辑。确认重切请加 --force。`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("已存在")) throw e;
      // JSON parse failure = the file is junk; safe to overwrite.
    }
  }

  const srtSrc = fs.readFileSync(opts.srtPath, "utf8");
  const rawCues = parseSrt(srtSrc);
  if (rawCues.length === 0) {
    throw new Error(`No cues parsed from ${opts.srtPath}`);
  }

  // ASR exports emit one cue per word/phrase (~0.5s). One-scene-per-cue would
  // produce hundreds of sub-second scenes and blow past the analyzer's reply
  // budget, so merge those into sentence-sized scenes. A normal sentence-per-cue
  // SRT is left exactly as-is.
  const cues = looksAsr(rawCues) ? mergeCues(rawCues) : rawCues;
  if (cues.length < rawCues.length) {
    console.log(`[plan] 检测到 ASR 式字幕(${rawCues.length} 条碎句)— 已合并为 ${cues.length} 个句级镜头`);
  }

  const scenes: Scene[] = cues.map((cue, i) => cueToScene(cue, i + 1));
  const assetPool = listAssets(opts.assetsDir);

  const storyboard: Storyboard = {
    source: path.relative(process.cwd(), opts.srtPath),
    project: {
      title: opts.title,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
      designDoc: opts.designDoc,
    },
    assetPool,
    scenes,
    createdAt: new Date().toISOString(),
    stages: {
      parsed: true,
      analyzed: false,
      approved: false,
      rendered: false,
    },
  };

  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  fs.writeFileSync(opts.outPath, JSON.stringify(storyboard, null, 2));
  return storyboard;
}
