import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickOfflineMethod, applyOfflinePicks, OFFLINE_SHORT_METHOD, OFFLINE_LONG_METHOD } from "./analyze-offline.ts";
import { runPlan } from "./plan.ts";
import { validateStoryboard, splitFindings } from "./validate.ts";

const INPUT = path.resolve(import.meta.dirname, "..", "input");

test("short cue → kinetic hero text; long or multi-line cue → plain fade caption", () => {
  assert.equal(pickOfflineMethod("前端视觉化套件比较"), OFFLINE_SHORT_METHOD);
  assert.equal(pickOfflineMethod("我们挑五个数据点来对比它们的安装量,看看谁增长最快"), OFFLINE_LONG_METHOD);
  assert.equal(pickOfflineMethod("第一行\n第二行"), OFFLINE_LONG_METHOD);
  assert.equal(pickOfflineMethod(""), OFFLINE_LONG_METHOD);
});

test("never picks methods that parse a pipe convention from text (they would misrender raw cues)", () => {
  for (const t of ["300|%|利率", "1997", "第六章|多米诺骨牌", "Q4 revenue up 40%"]) {
    assert.ok([OFFLINE_SHORT_METHOD, OFFLINE_LONG_METHOD].includes(pickOfflineMethod(t)), t);
  }
});

test("README sample: plan → analyze --offline → the render gate has no fatal errors left", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-offline-"));
  const outPath = path.join(dir, "output", "storyboard.json");
  runPlan({ srtPath: path.join(INPUT, "sample.srt"), outPath, designDoc: "design.md", assetsDir: path.join(dir, "assets"), title: "t", width: 1920, height: 1080, fps: 30 });
  const sb = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.ok(splitFindings(validateStoryboard(sb, dir)).errors.length > 0, "a fresh plan should be blocked (no methods)");
  assert.equal(applyOfflinePicks(sb), sb.scenes.length);
  assert.deepEqual(splitFindings(validateStoryboard(sb, dir)).errors, []);
  assert.equal(sb.stages.analyzed, true);
});

test("scenes that already have a method keep it", () => {
  const sb: any = { stages: {}, scenes: [{ index: 1, text: "短句", method: "hf-chapter-card", fallback: null, reasoning: "人选" }, { index: 2, text: "短句", method: null }] };
  assert.equal(applyOfflinePicks(sb), 1);
  assert.equal(sb.scenes[0].method, "hf-chapter-card");
  assert.equal(sb.scenes[0].reasoning, "人选");
  assert.equal(sb.scenes[1].method, OFFLINE_SHORT_METHOD);
  assert.match(sb.scenes[1].reasoning, /离线规则/);
});
