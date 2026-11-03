import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRender, REMOTION_DEPS, REMOTION_DEV_DEPS, remotionCacheDir, linkSharedNodeModules, findHeadlessShell } from "./render.ts";
import { CancelledError } from "./proc.ts";

console.log = () => {}; // render logs to stdout; keep node --test's result stream clean (see server-auth.test.ts)

test("Remotion stack is pinned to exact versions (no ^/~ ranges → reproducible renders)", () => {
  for (const [name, v] of Object.entries({ ...REMOTION_DEPS, ...REMOTION_DEV_DEPS })) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `${name}@${v}`);
  }
  const remotionPkgs = ["remotion", "@remotion/bundler", "@remotion/cli", "@remotion/renderer"].map((p) => REMOTION_DEPS[p]);
  assert.equal(new Set(remotionPkgs).size, 1, "remotion packages must move in lockstep");
});

test("the shared cache dir is keyed by the dependency set and lives outside any project", () => {
  const a = remotionCacheDir("/tmp/vm-cache");
  assert.match(path.basename(a), /^remotion-[0-9a-f]{12}$/);
  assert.equal(path.dirname(a), "/tmp/vm-cache");
  assert.equal(remotionCacheDir("/tmp/vm-cache"), a);
});

test("a scene links the shared node_modules; deleting the scene dir leaves the cache intact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vm-rmcache-"));
  const cache = path.join(root, "cache");
  fs.mkdirSync(path.join(cache, "node_modules", "remotion"), { recursive: true });
  fs.writeFileSync(path.join(cache, "node_modules", "remotion", "package.json"), "{}");
  const scene = path.join(root, "scene-001");
  fs.mkdirSync(path.join(scene, "node_modules", "stale"), { recursive: true }); // a pre-fix per-scene install
  linkSharedNodeModules(scene, cache);
  assert.ok(fs.lstatSync(path.join(scene, "node_modules")).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(scene, "node_modules", "remotion", "package.json")));
  fs.rmSync(scene, { recursive: true, force: true }); // what pruneStaleSceneArtifacts does
  assert.ok(fs.existsSync(path.join(cache, "node_modules", "remotion", "package.json")));
});

test("a cancelled render stops before rendering and does not mark scenes as failed", async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "vm-cancel-"));
  const outputDir = path.join(proj, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const sbPath = path.join(outputDir, "storyboard.json");
  fs.writeFileSync(sbPath, JSON.stringify({
    project: { title: "t", width: 640, height: 360, fps: 30, designDoc: "design.md", design: { presetId: "inkwork" } },
    stages: { parsed: true, analyzed: true, approved: true, rendered: false },
    scenes: [{ index: 1, cues: [1], startSec: 0, endSec: 2, durationSec: 2, text: "取消测试", method: "hf-css-fade", fallback: "hf-css-fade", reasoning: "t", assets: [], notes: [] }],
  }));
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    runRender({ storyboardPath: sbPath, outputDir, projectRoot: proj, force: true, only: null, skipValidate: true, signal: ac.signal }),
    (e: unknown) => e instanceof CancelledError,
  );
  const sb = JSON.parse(fs.readFileSync(sbPath, "utf8"));
  assert.notEqual(sb.scenes[0].status, "failed");
  assert.equal(fs.existsSync(path.join(outputDir, "final.mp4")), false);
});

test("Remotion reuses an already-downloaded headless shell instead of fetching its own", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vm-shell-"));
  const saved = process.env.PIPELINE_REMOTION_BROWSER;
  delete process.env.PIPELINE_REMOTION_BROWSER;
  try {
    assert.equal(findHeadlessShell(home), undefined);
    const exe = path.join(home, ".cache", "puppeteer", "chrome-headless-shell", "mac_arm-148.0.7778.97", "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, "");
    assert.equal(findHeadlessShell(home), exe);
    process.env.PIPELINE_REMOTION_BROWSER = "/opt/custom/chrome";
    assert.equal(findHeadlessShell(home), "/opt/custom/chrome");
  } finally {
    if (saved === undefined) delete process.env.PIPELINE_REMOTION_BROWSER; else process.env.PIPELINE_REMOTION_BROWSER = saved;
  }
});
