import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPromise, diffPromise } from "./promise.ts";
import { mkStoryboard, mkScene } from "./_testkit.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tmpOut(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vm-promise-"));
  return d;
}

test("buildPromise records scene count, design, and audio intent from disk", () => {
  const out = tmpOut();
  fs.writeFileSync(path.join(out, "voice-track.json"), "{}"); // voice was produced
  const sb = mkStoryboard({ scenes: [mkScene({ index: 1 }), mkScene({ index: 2, startSec: 3, endSec: 6 })] });
  const p = buildPromise(sb, out);
  assert.equal(p.sceneCount, 2);
  assert.equal(p.designId, "inkwork");
  assert.equal(p.audio.voice, true);
  assert.equal(p.audio.bgm, false);
  assert.equal(p.scenes.length, 2);
});

test("diffPromise is silent when the delivery honors the promise", () => {
  const out = tmpOut();
  const sb = mkStoryboard();
  const p = buildPromise(sb, out);
  assert.deepEqual(diffPromise(p, sb), []);
});

test("diffPromise flags a dropped scene, a method swap, and a design change", () => {
  const out = tmpOut();
  const sb = mkStoryboard({ scenes: [mkScene({ index: 1, method: "hf-css-fade" }), mkScene({ index: 2, method: "hf-kinetic-text", startSec: 3, endSec: 6 })] });
  const p = buildPromise(sb, out);

  // Deliver: scene 2 removed, scene 1's method changed, design swapped.
  const delivered = mkStoryboard({
    project: { ...sb.project, design: { presetId: "swiss" } } as any,
    scenes: [mkScene({ index: 1, method: "hf-poster-hero" })],
  });
  const msgs = diffPromise(p, delivered);
  assert.ok(msgs.some((m) => /镜头数/.test(m)), "scene count change");
  assert.ok(msgs.some((m) => /设计风格/.test(m)), "design change");
  assert.ok(msgs.some((m) => /#1 方法/.test(m)), "method swap on scene 1");
  assert.ok(msgs.some((m) => /#2/.test(m)), "scene 2 dropped");
});
