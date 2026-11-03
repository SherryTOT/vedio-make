import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSystemVoice, sayRate, systemTts } from "./tts.ts";
import { fallbackChain } from "../registry.ts";

test("zero-key tts chain ends in the offline system voice (Edge can be rejected by Microsoft)", () => {
  assert.deepEqual(fallbackChain("tts", "voice"), ["voice", "edge", "system"]);
  assert.deepEqual(fallbackChain("tts", "edge"), ["edge", "system"]);
});

test("pipeline voice ids map to macOS voices that actually ship (never the empty download-on-demand ones)", () => {
  assert.equal(resolveSystemVoice("zh-CN-YunjianNeural"), "Tingting");
  assert.equal(resolveSystemVoice("presenter_male"), "Tingting");
  assert.equal(resolveSystemVoice("minimax:female-shaonv"), "Tingting");
  assert.equal(resolveSystemVoice("zh-TW-HsiaoChenNeural"), "Meijia");
  assert.equal(resolveSystemVoice("zh-HK-HiuMaanNeural"), "Sinji");
  assert.equal(resolveSystemVoice("en-US-GuyNeural"), "Samantha");
  assert.equal(resolveSystemVoice("sinji"), "Sinji");
  assert.equal(resolveSystemVoice("Eddy"), "Tingting");
});

test("speed maps to say's words-per-minute and is clamped", () => {
  assert.equal(sayRate(undefined), 175);
  assert.equal(sayRate(1.2), 210);
  assert.equal(sayRate(9), 350);
  assert.equal(sayRate(0.1), 88);
});

test("system voice synthesizes real audio on macOS", { skip: process.platform !== "darwin" }, async () => {
  const mp3 = await systemTts.tts({ text: "这是一段测试配音。" });
  assert.ok(mp3.length > 2000, `mp3 too small: ${mp3.length} bytes`);
});
