import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const cli = (...args: string[]) =>
  spawnSync(path.join(ROOT, "node_modules", ".bin", "tsx"), [path.join(ROOT, "src", "cli.ts"), ...args], { cwd: ROOT, encoding: "utf8" });

test("--help / -h / help print the full usage and exit 0", () => {
  for (const flag of ["--help", "-h", "help"]) {
    const r = cli(flag);
    assert.equal(r.status, 0, `${flag}: ${r.stderr}`);
    assert.match(r.stdout, /pipeline render/);
    assert.match(r.stdout, /pipeline doctor/);
  }
});

test("help <cmd> prints only that command, including its continuation lines", () => {
  const r = cli("help", "analyze");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /pipeline analyze/);
  assert.match(r.stdout, /--offline/);
  assert.doesNotMatch(r.stdout, /pipeline render/);
});

test("help for an unknown command fails with the full list", () => {
  const r = cli("help", "nope");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /没有这个命令: nope/);
  assert.match(r.stderr, /pipeline plan/);
});
