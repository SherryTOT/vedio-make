import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreSlideshowRisk } from "./slideshow.ts";
import { mkStoryboard, mkScene } from "./_testkit.ts";

test("empty board scores max risk / fail", () => {
  const r = scoreSlideshowRisk(mkStoryboard({ scenes: [] }), "/tmp/x");
  assert.equal(r.verdict, "fail");
  assert.equal(r.average, 5);
});

test("very short board is not treated as a slideshow", () => {
  const sb = mkStoryboard({ scenes: [mkScene({ index: 1 }), mkScene({ index: 2, startSec: 3, endSec: 6 })] });
  assert.equal(scoreSlideshowRisk(sb, "/tmp/x").verdict, "strong");
});

test("monotonous board (same method, no reasoning) scores worse than a varied one", () => {
  const bad = mkStoryboard({
    scenes: [1, 2, 3, 4, 5].map((i) =>
      mkScene({ index: i, startSec: (i - 1) * 3, endSec: i * 3, durationSec: 3, method: "hf-css-fade", reasoning: "" }),
    ),
  });
  const methods = ["hf-css-fade", "hf-kinetic-text", "hf-stat-counter", "hf-chapter-card", "hf-anime-scatter"];
  const durs = [2, 4, 3, 5, 2];
  let acc = 0;
  const good = mkStoryboard({
    scenes: methods.map((m, k) => {
      const s = mkScene({ index: k + 1, startSec: acc, endSec: acc + durs[k], durationSec: durs[k], method: m, reasoning: "有明确意图" });
      acc += durs[k];
      return s;
    }),
  });
  assert.ok(scoreSlideshowRisk(bad, "/tmp/x").average > scoreSlideshowRisk(good, "/tmp/x").average);
});

test("uniform durations but varied methods is NOT flagged as monotonous (inversion fix)", () => {
  // Regression guard: method variety provides rhythm, so pacing_monotony must be
  // low even when every scene is the same length — it used to score max (5).
  const methods = ["hf-css-fade", "hf-kinetic-text", "hf-stat-counter", "hf-chapter-card", "hf-anime-scatter"];
  const sb = mkStoryboard({
    scenes: methods.map((m, k) =>
      mkScene({ index: k + 1, startSec: k * 3, endSec: (k + 1) * 3, durationSec: 3, method: m, reasoning: "ok" }),
    ),
  });
  const pacing = scoreSlideshowRisk(sb, "/tmp/x").dimensions.pacing_monotony;
  assert.ok(pacing.score <= 1.5, `varied methods should score low pacing risk, got ${pacing.score}`);
});

test("long static holds >6s are flagged (MOTION §二 视觉事件密度 dimension)", () => {
  // Two 8s static text-led cards with no motion → the >6s dimension should fire.
  const held = mkStoryboard({
    scenes: [
      mkScene({ index: 1, startSec: 0, endSec: 8, durationSec: 8, method: "hf-css-fade", reasoning: "x" }),
      mkScene({ index: 2, startSec: 8, endSec: 16, durationSec: 8, method: "hf-css-fade", reasoning: "y" }),
      mkScene({ index: 3, startSec: 16, endSec: 19, durationSec: 3, method: "hf-kinetic-text", reasoning: "z" }),
    ],
  });
  const dim = scoreSlideshowRisk(held, "/tmp/x").dimensions.long_static_hold;
  assert.ok(dim, "long_static_hold dimension exists");
  assert.ok(dim.score > 0, "held static cards raise the >6s risk");
  // A board with no long static holds scores 0 on this dimension.
  const brisk = mkStoryboard({
    scenes: [1, 2, 3, 4].map((i) => mkScene({ index: i, startSec: (i - 1) * 3, endSec: i * 3, durationSec: 3, method: "hf-kinetic-text", reasoning: "ok" })),
  });
  assert.equal(scoreSlideshowRisk(brisk, "/tmp/x").dimensions.long_static_hold.score, 0);
});

test("average always lands in [0, 5]", () => {
  const r = scoreSlideshowRisk(mkStoryboard({ scenes: [1, 2, 3].map((i) => mkScene({ index: i, startSec: i, endSec: i + 1, durationSec: 1 })) }), "/tmp/x");
  assert.ok(r.average >= 0 && r.average <= 5);
});
