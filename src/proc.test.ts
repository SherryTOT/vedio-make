import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, CancelledError } from "./proc.ts";

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25));
  return cond();
};

test("aborting kills the whole process group (including background children) and rejects as cancelled", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-proc-"));
  const pidFile = path.join(dir, "child.pid");
  const ac = new AbortController();
  // The shell starts a grandchild `sleep` in the same group and records its pid.
  const p = run("sh", ["-c", `sleep 30 & echo $! > ${pidFile}; wait`], { cwd: dir, signal: ac.signal, onLine: () => {} });
  assert.ok(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").trim() !== ""));
  const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
  assert.ok(alive(grandchild));
  const t0 = Date.now();
  ac.abort();
  await assert.rejects(p, (e: unknown) => e instanceof CancelledError);
  assert.ok(Date.now() - t0 < 2500, "cancel should not wait for the 30s sleep");
  assert.ok(await waitFor(() => !alive(grandchild)), "grandchild sleep must be killed with the group");
});

test("an already-aborted signal never spawns the command", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-proc-"));
  const marker = path.join(dir, "ran");
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(run("sh", ["-c", `touch ${marker}`], { cwd: dir, signal: ac.signal, onLine: () => {} }), CancelledError);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(fs.existsSync(marker), false);
});

test("a normal run still resolves and a failing one still rejects with its exit code", async () => {
  const dir = os.tmpdir();
  await run("sh", ["-c", "exit 0"], { cwd: dir, onLine: () => {} });
  await assert.rejects(run("sh", ["-c", "exit 3"], { cwd: dir, onLine: () => {} }), /exit 3/);
});
