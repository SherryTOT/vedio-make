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
  const srtSrc = fs.readFileSync(opts.srtPath, "utf8");
  const cues = parseSrt(srtSrc);
  if (cues.length === 0) {
    throw new Error(`No cues parsed from ${opts.srtPath}`);
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
