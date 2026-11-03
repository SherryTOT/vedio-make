// Pure board-state logic for the web UI — no DOM, no fetch — so it can be unit-tested
// under node:test (src/board-state.test.ts). app.js owns rendering and I/O.

/** Fields the render task writes per scene; local edits must never discard them. */
export const RENDER_FIELDS = ["renderedPath", "renderedHash", "status"];

/** Re-index scenes 1..n and lay them back-to-back on the timeline (after add/move/delete). */
export function renumberScenes(scenes) {
  let t = 0;
  scenes.forEach((sc, k) => {
    sc.index = k + 1;
    sc.startSec = t;
    sc.endSec = t + (sc.durationSec || 0);
    t = sc.endSec;
  });
  return scenes;
}

/**
 * Merge the on-disk board after a task. Clean board → disk is authoritative. Dirty board →
 * keep the local edits, graft only render-owned fields (+ stages), and ask the caller to save
 * the merged copy — otherwise a pending autosave would clobber what the task just wrote.
 * Mutates `local` in the dirty case.
 */
export function reconcileBoard(local, fresh, dirty) {
  if (!dirty || !local) return { sb: fresh, needsSave: false };
  const byIdx = new Map((fresh.scenes || []).map((s) => [s.index, s]));
  for (const sc of local.scenes || []) {
    const d = byIdx.get(sc.index);
    if (d) for (const f of RENDER_FIELDS) sc[f] = d[f];
  }
  if (fresh.stages) local.stages = fresh.stages;
  // The merged copy now contains this disk version's render state, so save against its rev
  // (otherwise the server would refuse the follow-up save as stale).
  if (fresh.rev) local.rev = fresh.rev;
  return { sb: local, needsSave: true };
}

/**
 * What a failed storyboard PUT means for the UI — never report "已保存" when the bytes didn't land.
 * stale: someone else wrote since we read (server code "stale") → refetch, merge, retry now.
 * busy:  a render is running (409) → keep the edits and retry later.
 */
export function classifySaveError(message, code) {
  if (code === "stale") return { kind: "stale", status: "分镜已被更新,合并后重试" };
  if (/渲染进行中|409/.test(message || "")) {
    return { kind: "busy", retryMs: 5000, status: "渲染中,稍后自动保存" };
  }
  return { kind: "error", status: "保存失败" };
}
