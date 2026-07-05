import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "./fsutil.ts";

test("writes the full contents and leaves no temp file behind", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-atomic-"));
  const dest = path.join(dir, "scene-001.abc.png");
  writeFileAtomic(dest, Buffer.from("PNGBYTES"));
  assert.equal(fs.readFileSync(dest, "utf8"), "PNGBYTES");
  assert.deepEqual(fs.readdirSync(dir), ["scene-001.abc.png"], "a temp file was left behind");
});

test("overwrites an existing file in place", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-atomic-"));
  const dest = path.join(dir, "a.mp3");
  writeFileAtomic(dest, "v1");
  writeFileAtomic(dest, "v2");
  assert.equal(fs.readFileSync(dest, "utf8"), "v2");
  assert.equal(fs.readdirSync(dir).length, 1);
});
