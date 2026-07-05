/**
 * Minimal SRT parser.
 *
 * SRT format:
 *   1
 *   00:00:01,000 --> 00:00:04,500
 *   First caption line
 *   Optional second line
 *   <blank>
 *   2
 *   00:00:05,000 --> 00:00:08,000
 *   Next caption
 *
 * Times: HH:MM:SS,mmm (comma decimal separator).
 */

import type { Cue } from "./types.ts";

const TIME_RE = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function timeToSec(h: string, m: string, s: string, ms: string): number {
  return (
    parseInt(h, 10) * 3600 +
    parseInt(m, 10) * 60 +
    parseInt(s, 10) +
    parseInt(ms.padEnd(3, "0").slice(0, 3), 10) / 1000
  );
}

export function parseSrt(src: string): Cue[] {
  const cues: Cue[] = [];
  // Normalize line endings, strip BOM
  const text = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  // Split on blank lines (handles trailing whitespace)
  const blocks = text.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    // First line is the index (or webvtt cue id); time line is the one with -->
    let timeLineIdx = lines.findIndex((l) => TIME_RE.test(l));
    if (timeLineIdx === -1) continue;

    const idxLine = timeLineIdx > 0 ? lines[timeLineIdx - 1] : "";
    const m = lines[timeLineIdx].match(TIME_RE)!;
    const startSec = timeToSec(m[1], m[2], m[3], m[4]);
    const endSec = timeToSec(m[5], m[6], m[7], m[8]);
    const textLines = lines.slice(timeLineIdx + 1);
    if (textLines.length === 0) continue;

    // Strip inline markup: HTML/font tags (<i>, <font …>, <b>) and ASS/SSA
    // override blocks ({\an8}, {\pos(…)}). Left in, they render as visible
    // literal text on screen AND get spoken by TTS. Drop the cue if nothing
    // but markup remained.
    const text = textLines
      .join("\n")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .trim();
    if (!text) continue;

    const index = Number.parseInt(idxLine, 10);
    cues.push({
      index: Number.isFinite(index) ? index : cues.length + 1,
      startSec,
      endSec,
      text,
    });
  }

  return cues;
}

export function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "." +
    String(ms).padStart(3, "0")
  );
}
