import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEdgeVoice } from "./tts.ts";

test("genuine Edge voice ids pass through unchanged", () => {
  assert.equal(resolveEdgeVoice("zh-CN-YunjianNeural"), "zh-CN-YunjianNeural");
  assert.equal(resolveEdgeVoice("en-US-AriaNeural"), "en-US-AriaNeural");
});

test("MiniMax default 'presenter_male' maps to a male Edge voice (free-path fix)", () => {
  // The exact regression: this MiniMax id used to go verbatim into Edge SSML,
  // producing no audio and breaking the whole keyless path.
  assert.equal(resolveEdgeVoice("presenter_male"), "zh-CN-YunjianNeural");
});

test("'presenter_female' maps to a female voice (female checked before male)", () => {
  assert.equal(resolveEdgeVoice("presenter_female"), "zh-CN-XiaoxiaoNeural");
});

test("bare MiniMax male id maps to a male Edge voice", () => {
  assert.equal(resolveEdgeVoice("male-qn-jingying"), "zh-CN-YunjianNeural");
});

test("empty / unknown voiceId falls back to a warm female narrator", () => {
  assert.equal(resolveEdgeVoice(""), "zh-CN-XiaoxiaoNeural");
  assert.equal(resolveEdgeVoice(undefined), "zh-CN-XiaoxiaoNeural");
  assert.equal(resolveEdgeVoice("minimax:user_abc"), "zh-CN-XiaoxiaoNeural");
});
