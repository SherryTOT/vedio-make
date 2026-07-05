import fs from "node:fs";
import path from "node:path";

/**
 * Write a file atomically: write to a sibling temp file, then rename it over the
 * destination (rename is atomic on the same filesystem). This prevents a crash /
 * kill / disk-full mid-write from leaving a TRUNCATED file at `dest` — which
 * existence-based caches (generated images, TTS mp3s) would otherwise treat as a
 * valid cache hit and reuse forever.
 */
export function writeFileAtomic(dest: string, data: Buffer | string): void {
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.tmp-${process.pid}`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dest);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw e;
  }
}
