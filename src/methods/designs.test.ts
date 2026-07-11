import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDesign, resolveSceneDesign, DESIGNS, DEFAULT_DESIGN_ID,
  hexToName, isDarkPaper, tokensToPromptPalette,
} from "./designs.ts";

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

// ── image-prompt palette (DIRECTION §〇: generated art shares the layout's blood-type) ──

test("hexToName maps the workshop tokens to sensible colour words", () => {
  assert.equal(hexToName("#ffffff"), "bright white");
  assert.equal(hexToName("#111111"), "near-black");
  assert.equal(hexToName("#f6f5f1"), "warm cream");      // inkwork paper
  assert.equal(hexToName("#1b1612"), "warm near-black");  // inkwork ink
  assert.equal(hexToName("#c36c36"), "terracotta brown"); // inkwork accent
  assert.equal(hexToName("#d8382b"), "red");              // swiss accent
  assert.equal(hexToName("#1f49c7"), "blue");             // magazine accent (cobalt)
  assert.equal(hexToName("#8aa893"), "muted green");      // nocturne accent (sage)
});

test("hexToName tolerates garbage without throwing", () => {
  assert.equal(hexToName("not-a-hex"), "neutral");
  assert.equal(hexToName("rgba(0,0,0,0.1)"), "neutral");
});

test("isDarkPaper distinguishes dark vs light schemes", () => {
  assert.equal(isDarkPaper("#1a1c1e"), true);   // nocturne — dark bg
  assert.equal(isDarkPaper("#f6f5f1"), false);  // inkwork — light paper
  assert.equal(isDarkPaper("#ffffff"), false);
});

test("tokensToPromptPalette describes the live tokens + bakes in guardrails", () => {
  const p = tokensToPromptPalette(resolveDesign({ presetId: "inkwork" }));
  assert.match(p, /light scheme/);
  assert.match(p, /warm cream paper/);
  assert.match(p, /terracotta brown as the single accent/);
  // Print-workshop guardrails must always ride along (MOTION.md 红线 3 & 7).
  assert.match(p, /no gradients/);
  assert.match(p, /no glow/);
  assert.match(p, /no neon/);
});

test("nocturne palette is described as a dark scheme", () => {
  const p = tokensToPromptPalette(resolveDesign({ presetId: "nocturne" }));
  assert.match(p, /dark scheme/);
  assert.match(p, /muted green as the single accent/);
});

test("no preset ever prescribes the banned purple/gold hue as its accent", () => {
  for (const id of Object.keys(DESIGNS)) {
    const acc = hexToName(resolveDesign({ presetId: id }).accent);
    assert.doesNotMatch(acc, /purple|violet|gold/i, `${id} accent reads as a banned hue: ${acc}`);
  }
});

test("palette is override-safe — changing the accent changes the words", () => {
  const base = tokensToPromptPalette(resolveDesign({ presetId: "inkwork" }));
  const overridden = tokensToPromptPalette(
    resolveSceneDesign({ presetId: "inkwork" }, { overrides: { accent: "#1f49c7" } }),
  );
  assert.match(base, /terracotta brown as the single accent/);
  assert.match(overridden, /blue as the single accent/);
  assert.notEqual(base, overridden);
});
