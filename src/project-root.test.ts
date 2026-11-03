import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProjectRoot, catalogPathFor, PACKAGE_ROOT } from "./project-root.ts";

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vm-root-")));
const write = (p: string, body: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };

test("a checkout is found from any subdirectory by its current package name (vedio-make)", () => {
  const repo = tmp();
  write(path.join(repo, "package.json"), JSON.stringify({ name: "vedio-make" }));
  fs.mkdirSync(path.join(repo, "src", "methods"), { recursive: true });
  assert.equal(findProjectRoot(path.join(repo, "src", "methods")), repo);
});

test("the pre-rename package name still counts", () => {
  const repo = tmp();
  write(path.join(repo, "package.json"), JSON.stringify({ name: "video-pipeline" }));
  assert.equal(findProjectRoot(repo), repo);
});

test("a daemon project (project.json) is its own root, even inside the repo's projects/", () => {
  const repo = tmp();
  write(path.join(repo, "package.json"), JSON.stringify({ name: "vedio-make" }));
  const proj = path.join(repo, "projects", "demo-1");
  write(path.join(proj, "project.json"), "{}");
  fs.mkdirSync(path.join(proj, "output"), { recursive: true });
  assert.equal(findProjectRoot(path.join(proj, "output")), proj);
});

test("no marker → the directory itself, never the installed package (a render there would prune the wrong cache)", () => {
  const dir = path.join(tmp(), "my-video");
  fs.mkdirSync(dir);
  assert.equal(findProjectRoot(dir), dir);
  assert.notEqual(findProjectRoot(dir), PACKAGE_ROOT);
});

test("catalog: a project's own copy wins, otherwise the package default", () => {
  const proj = tmp();
  assert.equal(catalogPathFor(proj), path.join(PACKAGE_ROOT, "methods", "catalog.json"));
  assert.ok(fs.existsSync(catalogPathFor(proj)));
  write(path.join(proj, "methods", "catalog.json"), "{}");
  assert.equal(catalogPathFor(proj), path.join(proj, "methods", "catalog.json"));
});
