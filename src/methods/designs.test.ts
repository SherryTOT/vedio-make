import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDesign, resolveSceneDesign, DESIGNS, DEFAULT_DESIGN_ID } from "./designs.ts";

test("default (undefined) resolves to inkwork tokens", () => {
  const d = resolveDesign(undefined);
  assert.equal(d.__presetId, "inkwork");
  assert.equal(d.paper, "#f6f5f1");
  assert.equal(d.ink, "#1b1612");
  assert.equal(d.accent, "#c36c36");
});

test("nocturne preset flows through (the W1 fix relies on this)", () => {
  const d = resolveDesign({ presetId: "nocturne" });
  assert.equal(d.paper, "#1a1c1e");
  assert.equal(d.ink, "#eceae4");
});

test("terra/terra2 migration aliases are fully removed", () => {
  const d: any = resolveDesign(undefined);
  assert.equal(d.terra, undefined, "terra alias reintroduced");
  assert.equal(d.terra2, undefined, "terra2 alias reintroduced");
});

test("every preset defines a 5-colour chartPalette", () => {
  for (const id of Object.keys(DESIGNS)) {
    const d = resolveDesign({ presetId: id });
    assert.equal(d.chartPalette.length, 5, `${id} chartPalette wrong length`);
  }
});

test("scene preset override wins over project preset", () => {
  const d = resolveSceneDesign({ presetId: "inkwork" }, { presetId: "swiss" });
  assert.equal(d.__presetId, "swiss");
  assert.equal(d.accent, "#d8382b");
});

test("scene token override layers on the project preset", () => {
  const d = resolveSceneDesign({ presetId: "inkwork" }, { overrides: { accent: "#000000" } });
  assert.equal(d.__presetId, "inkwork");
  assert.equal(d.accent, "#000000");
});

test("unknown preset id falls back to default", () => {
  assert.equal(resolveDesign({ presetId: "does-not-exist" }).__presetId, DEFAULT_DESIGN_ID);
});
