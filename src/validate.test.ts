import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStoryboard, splitFindings } from "./validate.ts";
import { mkStoryboard, mkScene } from "./_testkit.ts";

const errorsOf = (sb: any) => splitFindings(validateStoryboard(sb, "/tmp/nonexistent-project", null)).errors;

test("a healthy storyboard has no fatal errors", () => {
  assert.equal(errorsOf(mkStoryboard()).length, 0);
});

test("null method is a fatal error", () => {
  const sb = mkStoryboard({ scenes: [mkScene({ method: null as any })] });
  assert.ok(errorsOf(sb).length > 0);
});

test("unknown method is a fatal error", () => {
  const sb = mkStoryboard({ scenes: [mkScene({ method: "hf-does-not-exist" })] });
  assert.ok(errorsOf(sb).some((e) => /method|方法/i.test(e.msg) || e.code === "unknown-method"));
});

test("duplicate scene index is a fatal error", () => {
  const sb = mkStoryboard({
    scenes: [
      mkScene({ index: 1, startSec: 0, endSec: 3, durationSec: 3 }),
      mkScene({ index: 1, startSec: 3, endSec: 6, durationSec: 3 }),
    ],
  });
  assert.ok(errorsOf(sb).length > 0);
});

test("negative/zero duration is a fatal error", () => {
  const sb = mkStoryboard({ scenes: [mkScene({ startSec: 0, endSec: 0, durationSec: 0 })] });
  assert.ok(errorsOf(sb).length > 0);
});
