import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — plain ES module shipped to the browser as-is (no build step, zero deps).
import { renumberScenes, reconcileBoard, classifySaveError } from "../public/state.js";

const scene = (index: number, text: string, extra: Record<string, unknown> = {}) =>
  ({ index, text, durationSec: 2, startSec: 0, endSec: 0, ...extra });

test("renumberScenes re-indexes from 1 and lays scenes back-to-back", () => {
  const s = renumberScenes([scene(7, "a", { durationSec: 1.5 }), scene(3, "b", { durationSec: 2 }), scene(9, "c", { durationSec: 0.5 })]);
  assert.deepEqual(s.map((x: any) => [x.index, x.startSec, x.endSec]), [[1, 0, 1.5], [2, 1.5, 3.5], [3, 3.5, 4]]);
});

test("renumberScenes treats a missing duration as zero instead of NaN", () => {
  const s = renumberScenes([{ index: 0 }, scene(0, "b")]);
  assert.deepEqual(s.map((x: any) => [x.startSec, x.endSec]), [[0, 0], [0, 2]]);
});

test("reconcileBoard on a clean board takes disk wholesale and needs no save", () => {
  const fresh = { scenes: [scene(1, "disk")], stages: { rendered: true } };
  const r = reconcileBoard({ scenes: [scene(1, "old")] }, fresh, false);
  assert.equal(r.sb, fresh);
  assert.equal(r.needsSave, false);
});

test("reconcileBoard on a dirty board keeps local edits and grafts render fields", () => {
  const local = { scenes: [scene(1, "我刚改的字"), scene(2, "第二镜")] };
  const fresh = { scenes: [
    scene(1, "旧字", { renderedPath: "output/scenes/1.mp4", renderedHash: "h1", status: "rendered" }),
    scene(2, "第二镜", { status: "failed" }),
  ] };
  const r = reconcileBoard(local, fresh, true);
  assert.equal(r.needsSave, true);
  assert.equal(r.sb.scenes[0].text, "我刚改的字");
  assert.equal(r.sb.scenes[0].renderedHash, "h1");
  assert.equal(r.sb.scenes[0].status, "rendered");
  assert.equal(r.sb.scenes[1].status, "failed");
});

test("reconcileBoard on a dirty board adopts disk stages", () => {
  const r = reconcileBoard({ scenes: [], stages: { approved: false } }, { scenes: [], stages: { approved: true } }, true);
  assert.deepEqual(r.sb.stages, { approved: true });
});

test("reconcileBoard leaves a locally added scene (absent on disk) untouched", () => {
  const local = { scenes: [scene(1, "a"), scene(2, "新加的", { status: "pending" })] };
  const r = reconcileBoard(local, { scenes: [scene(1, "a", { status: "rendered" })] }, true);
  assert.equal(r.sb.scenes[1].status, "pending");
  assert.equal(r.sb.scenes[1].text, "新加的");
});

test("classifySaveError: render-busy 409 keeps edits and retries later", () => {
  const d = classifySaveError("渲染进行中,暂不能保存分镜(避免与渲染进程互相覆盖状态文件)。");
  assert.equal(d.kind, "busy");
  assert.equal(d.retryMs, 5000);
});

test("classifySaveError: any other failure is surfaced as an error, never as saved", () => {
  assert.equal(classifySaveError("Internal Server Error").kind, "error");
  assert.equal(classifySaveError(undefined).kind, "error");
});

test("classifySaveError: a stale-rev 409 means refetch + merge + retry now", () => {
  assert.equal(classifySaveError("分镜已被其他进程更新(版本不一致)", "stale").kind, "stale");
});

test("reconcileBoard on a dirty board adopts the disk rev it merged, so the next save is not refused", () => {
  const local = { rev: "old", scenes: [scene(1, "我改的")] };
  const fresh = { rev: "new", scenes: [scene(1, "x", { status: "rendered" })] };
  const r = reconcileBoard(local, fresh, true);
  assert.equal(r.sb.rev, "new");
  assert.equal(r.sb.scenes[0].text, "我改的");
  assert.equal(r.sb.scenes[0].status, "rendered");
});
