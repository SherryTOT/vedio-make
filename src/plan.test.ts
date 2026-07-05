import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCues } from "./plan.ts";
import { parseSrt } from "./srt.ts";
import type { Cue } from "./types.ts";

const cue = (index: number, startSec: number, endSec: number, text: string): Cue => ({ index, startSec, endSec, text });

test("mergeCues leaves a normal sentence-per-cue SRT untouched", () => {
  const cues = [
    cue(1, 0, 3.5, "第一句完整的话。"),
    cue(2, 3.5, 7, "第二句也很完整。"),
  ];
  const merged = mergeCues(cues);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, "第一句完整的话。");
});

test("mergeCues merges ASR word-level cues into sentence-sized scenes", () => {
  // Sub-second cues, sentence terminator only at the end of each group.
  const cues = [
    cue(1, 0.0, 0.5, "今天"),
    cue(2, 0.5, 1.0, "我们"),
    cue(3, 1.0, 1.6, "来看"),
    cue(4, 1.6, 2.4, "一个例子。"),
    cue(5, 2.4, 3.0, "它"),
    cue(6, 3.0, 3.8, "很有趣。"),
  ];
  const merged = mergeCues(cues);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, "今天我们来看一个例子。");
  assert.equal(merged[0].startSec, 0);
  assert.equal(merged[0].endSec, 2.4);
  assert.equal(merged[1].text, "它很有趣。");
});

test("mergeCues starts a new scene on a real pause between cues", () => {
  const cues = [
    cue(1, 0.0, 1.0, "开头一段"),
    cue(2, 1.0, 2.0, "还在继续"),
    // 2s silent gap → hard break even without a terminator
    cue(3, 4.0, 5.0, "隔了很久之后"),
  ];
  const merged = mergeCues(cues);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, "开头一段还在继续");
});

test("mergeCues joins latin words with a space but CJK without", () => {
  const cues = [
    cue(1, 0, 0.6, "hello"),
    cue(2, 0.6, 1.2, "world"),
    cue(3, 1.2, 3.0, "done."),
  ];
  const merged = mergeCues(cues);
  assert.equal(merged[0].text, "hello world done.");
});

test("parseSrt strips HTML/ASS markup and drops markup-only cues", () => {
  const srt = [
    "1",
    "00:00:00,000 --> 00:00:02,000",
    "<i>斜体</i>正文<font color=\"red\">红</font>",
    "",
    "2",
    "00:00:02,000 --> 00:00:04,000",
    "{\\an8}顶部字幕",
    "",
    "3",
    "00:00:04,000 --> 00:00:06,000",
    "{\\pos(10,20)}",
    "",
  ].join("\n");
  const cues = parseSrt(srt);
  assert.equal(cues.length, 2); // cue 3 was markup-only → dropped
  assert.equal(cues[0].text, "斜体正文红");
  assert.equal(cues[1].text, "顶部字幕");
});
