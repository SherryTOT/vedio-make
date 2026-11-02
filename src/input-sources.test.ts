import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseSrt } from "./srt.ts";
import { mergeCues } from "./plan.ts";

const INPUT = path.resolve(import.meta.dirname, "..", "input");
const read = (f: string) => fs.readFileSync(path.join(INPUT, f), "utf8");
const srts = fs.readdirSync(INPUT).filter((f) => f.endsWith(".srt"));

test("every published sample SRT has a provenance row in input/SOURCES.md", () => {
  // The repo is public: third-party transcripts must not ship here (keep them in input/ref/, gitignored).
  const sources = read("SOURCES.md");
  const listed = [...sources.matchAll(/^\| `([^`]+\.srt)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(srts.filter((f) => !listed.includes(f)), [], "unlisted .srt in input/");
  assert.deepEqual(listed.filter((f) => !srts.includes(f)), [], "SOURCES.md lists a missing .srt");
});

test("every sample SRT parses to at least one cue", () => {
  for (const f of srts) assert.ok(parseSrt(read(f)).length > 0, f);
});

test("ASR-style longform sample is fragmented enough to exercise mergeCues", () => {
  const cues = parseSrt(read("sample-asr-longform.srt"));
  assert.ok(cues.length >= 60);
  assert.ok(mergeCues(cues).length < cues.length);
});
