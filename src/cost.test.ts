import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateStoryboard } from "./cost.ts";
import { mkStoryboard, mkScene } from "./_testkit.ts";

test("edge TTS provider is free ($0)", () => {
  const e = estimateStoryboard(mkStoryboard(), { ttsProvider: "edge", withTts: true });
  const tts = e.lineItems.find((i) => i.category === "tts")!;
  assert.equal(tts.free, true);
  assert.equal(tts.totalUsd, 0);
});

test("explicit minimax TTS is priced as paid (not free)", () => {
  const e = estimateStoryboard(mkStoryboard(), { ttsProvider: "minimax", withTts: true });
  const tts = e.lineItems.find((i) => i.category === "tts")!;
  assert.equal(tts.free, false);
  assert.ok(tts.unitUsd > 0);
});

test("minimax music track is charged", () => {
  const e = estimateStoryboard(mkStoryboard(), { withMusic: true, musicProvider: "minimax" });
  const music = e.lineItems.find((i) => i.category === "music")!;
  assert.ok(music.totalUsd > 0);
});

test("all-free board totals $0 with high confidence", () => {
  const e = estimateStoryboard(mkStoryboard(), { ttsProvider: "edge", withTts: true, withImages: false, withMusic: false });
  assert.equal(e.totalUsd, 0);
  assert.equal(e.confidence, "high");
});

test("default TTS provider ('voice') is priced as paid, not silently free", () => {
  // Regression guard for the cost-underreport fix (#7): the default voice router
  // sends bare voiceIds to paid MiniMax, so the estimate must NOT mark it free.
  const tts = estimateStoryboard(mkStoryboard(), { withTts: true }).lineItems.find((i) => i.category === "tts")!;
  assert.equal(tts.provider, "voice");
  assert.equal(tts.free, false, "default 'voice' TTS mis-priced as free");
  assert.ok(tts.unitUsd > 0);
});
