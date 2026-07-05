import { test } from "node:test";
import assert from "node:assert/strict";
import { lintSource } from "./lint.ts";

const has = (src: string, code: string) => lintSource(src).some((f) => f.code === code);

test("clean inkwork source trips nothing", () => {
  const src = `.line { color: #1b1612; background: #f6f5f1; }`;
  assert.deepEqual(lintSource(src), []);
});

test("gradient text is flagged", () => {
  const src = `.t { -webkit-text-fill-color: transparent; background: linear-gradient(90deg,#fff,#000); }`;
  assert.ok(has(src, "gradient-text"));
});

test("glow (drop-shadow 0 0) is flagged", () => {
  assert.ok(has(`.x { filter: drop-shadow(0 0 20px gold); }`, "glow"));
});

test("glassmorphism (backdrop blur) is flagged", () => {
  assert.ok(has(`.x { backdrop-filter: blur(8px); }`, "glass"));
});

test("AI gold palette is flagged", () => {
  assert.ok(has(`.x { color: #f4d479; }`, "ai-palette"));
});

test("empty source returns no findings", () => {
  assert.deepEqual(lintSource(""), []);
});
