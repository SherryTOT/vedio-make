import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateStoryboard, splitFindings } from "./validate.ts";
import { mkStoryboard, mkScene } from "./_testkit.ts";

/** Build a temp project root with output/voice-track.json + optional mp3s. */
function projectWithVoice(entries: Array<{ index: number; text: string; file: string; writeMp3: boolean }>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vm-voice-"));
  fs.mkdirSync(path.join(root, "output", "voice"), { recursive: true });
  for (const e of entries) if (e.writeMp3) fs.writeFileSync(path.join(root, e.file), "x");
  fs.writeFileSync(
    path.join(root, "output", "voice-track.json"),
    JSON.stringify({ scenes: entries.map((e) => ({ index: e.index, text: e.text, file: e.file })) }),
  );
  return root;
}

const findings = (sb: any, root: string) => validateStoryboard(sb, root, null);
const codes = (sb: any, root: string) => findings(sb, root).map((f) => f.code);

test("voice track present, mp3 exists, text matches → no voice error", () => {
  const root = projectWithVoice([{ index: 1, text: "示例文案", file: "output/voice/scene-001.mp3", writeMp3: true }]);
  const sb = mkStoryboard({ scenes: [mkScene({ index: 1, text: "示例文案" })] });
  const { errors } = splitFindings(findings(sb, root));
  assert.equal(errors.filter((e) => /voice/.test(e.code)).length, 0);
});

test("missing voice mp3 is a fatal error caught pre-render", () => {
  const root = projectWithVoice([{ index: 1, text: "示例文案", file: "output/voice/scene-001.mp3", writeMp3: false }]);
  const sb = mkStoryboard({ scenes: [mkScene({ index: 1, text: "示例文案" })] });
  assert.ok(codes(sb, root).includes("missing-voice"));
});

test("edited scene text since tts ran → stale-voice error (silent drop prevented)", () => {
  const root = projectWithVoice([{ index: 1, text: "旧文案", file: "output/voice/scene-001.mp3", writeMp3: true }]);
  const sb = mkStoryboard({ scenes: [mkScene({ index: 1, text: "改过的新文案" })] });
  assert.ok(codes(sb, root).includes("stale-voice"));
});

test("single-scene render (onlyIndex set) skips the voice gate", () => {
  const root = projectWithVoice([{ index: 1, text: "旧文案", file: "output/voice/scene-001.mp3", writeMp3: false }]);
  const sb = mkStoryboard({ scenes: [mkScene({ index: 1, text: "改过的新文案" })] });
  const f = validateStoryboard(sb, root, 1);
  assert.equal(f.filter((x) => /voice/.test(x.code)).length, 0);
});
