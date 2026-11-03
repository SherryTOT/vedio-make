/**
 * Where a CLI command reads and writes `output/`. Getting this wrong is destructive: a full render
 * prunes stale scene artifacts under the root it was given, so a wrong root deletes another
 * project's render cache.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout / installed package this CLI ships in (holds the default methods catalog). */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Current package name + the pre-rename one (the repo was `video-pipeline` before it became vedio-make).
const PACKAGE_NAMES = new Set(["vedio-make", "video-pipeline"]);

/**
 * Nearest ancestor of `start` that is a daemon project (has project.json) or this repo (package.json
 * named vedio-make / video-pipeline). With no marker, `start` itself — outputs land where the user is
 * working, never inside the installed package.
 */
export function findProjectRoot(start: string): string {
  let cur = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, "project.json"))) return cur;
    const pkg = path.join(cur, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        if (PACKAGE_NAMES.has(JSON.parse(fs.readFileSync(pkg, "utf8")).name)) return cur;
      } catch {}
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(start);
}

/** A project's own methods catalog if it has one (daemon projects copy it in), else the package default. */
export function catalogPathFor(root: string): string {
  const own = path.join(root, "methods", "catalog.json");
  return fs.existsSync(own) ? own : path.join(PACKAGE_ROOT, "methods", "catalog.json");
}
