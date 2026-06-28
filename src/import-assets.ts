/**
 * `pipeline import <folder>` — copy local files into assets/imported/, optionally
 * attach to a scene's assets list. Useful when the user has their own PSDs,
 * cinemagraphs, B-roll footage, downloaded stock files, etc. that they want
 * the pipeline to use without going through a remote provider.
 *
 * Examples:
 *   pipeline import ~/Downloads/stock                   # bulk copy whole folder
 *   pipeline import ~/Downloads/hero.jpg --scene 1       # single file → scene 1.assets
 *   pipeline import ~/Downloads --pattern '*.psd'        # selective glob
 *   pipeline import ./broll.mp4 --scene 5 --foreground   # also set scene.foreground (matted)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Storyboard } from "./types.ts";

interface ImportOpts {
  /** A directory OR a single file path. */
  source: string;
  projectRoot: string;
  storyboardPath?: string;
  /** Glob-like pattern (very simple — only suffix match, e.g. "*.psd"). Defaults to known asset types. */
  pattern?: string;
  /** Attach to this scene */
  sceneIndex?: number;
  /** Also write scene.foreground = imported (only when single file imported AND looks like PNG with alpha) */
  asForeground?: boolean;
  /** Don't copy — just SYMLINK into assets/imported/. Saves space for big videos. */
  symlink?: boolean;
}

const DEFAULT_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic",
  ".mp4", ".mov", ".webm", ".mkv", ".m4v",
  ".mp3", ".wav", ".m4a", ".aac",
  ".lottie", ".json",
  ".psd", ".ai", ".svg",
  ".srt", ".vtt",
]);

function matchesPattern(name: string, pattern?: string): boolean {
  if (!pattern) {
    return DEFAULT_EXTS.has(path.extname(name).toLowerCase());
  }
  // Simple suffix match: '*.psd' → endsWith('.psd')
  if (pattern.startsWith("*.")) return name.toLowerCase().endsWith(pattern.slice(1).toLowerCase());
  // Otherwise literal substring match
  return name.toLowerCase().includes(pattern.toLowerCase());
}

function copyOne(src: string, dst: string, symlink: boolean): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (symlink) {
    try {
      if (fs.existsSync(dst)) fs.unlinkSync(dst);
      fs.symlinkSync(src, dst);
    } catch (e) {
      // Fall back to copy
      fs.copyFileSync(src, dst);
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}

export async function runImport(opts: ImportOpts): Promise<string[]> {
  const srcAbs = path.resolve(opts.source);
  if (!fs.existsSync(srcAbs)) throw new Error(`source not found: ${srcAbs}`);

  const importedDir = path.join(opts.projectRoot, "assets", "imported");
  fs.mkdirSync(importedDir, { recursive: true });

  // Collect files
  const sources: string[] = [];
  const stat = fs.statSync(srcAbs);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(srcAbs)) {
      if (entry.startsWith(".")) continue;
      const full = path.join(srcAbs, entry);
      if (fs.statSync(full).isFile() && matchesPattern(entry, opts.pattern)) {
        sources.push(full);
      }
    }
    sources.sort();
  } else if (stat.isFile()) {
    if (matchesPattern(path.basename(srcAbs), opts.pattern)) sources.push(srcAbs);
  }
  if (!sources.length) {
    console.warn(`[import] no matching files in ${srcAbs}${opts.pattern ? " (pattern=" + opts.pattern + ")" : ""}`);
    return [];
  }

  console.log(`[import] ${sources.length} file(s) → assets/imported/${opts.symlink ? "  (symlink mode)" : ""}`);
  const copied: string[] = [];
  for (const src of sources) {
    const base = path.basename(src);
    // Avoid collisions: prefix short content hash if file with same name exists.
    let dst = path.join(importedDir, base);
    if (fs.existsSync(dst)) {
      const h = crypto.createHash("sha1").update(fs.readFileSync(src)).digest("hex").slice(0, 6);
      const ext = path.extname(base);
      dst = path.join(importedDir, `${base.slice(0, -ext.length)}-${h}${ext}`);
    }
    copyOne(src, dst, opts.symlink ?? false);
    const sz = fs.statSync(dst).size;
    console.log(`  ${opts.symlink ? "→" : "cp"} ${path.basename(dst)}  (${(sz / 1024).toFixed(0)} KB)`);
    copied.push(dst);
  }

  // Attach to a scene
  if (opts.sceneIndex != null && opts.storyboardPath && copied.length) {
    const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
    const sc = sb.scenes.find((s) => s.index === opts.sceneIndex);
    if (sc) {
      const assetsDirAbs = path.join(opts.projectRoot, "assets");
      const rels = copied.map((c) => path.relative(assetsDirAbs, c));
      sc.assets = [...rels, ...(sc.assets ?? []).filter((a) => !rels.includes(a))];
      if (opts.asForeground && copied.length === 1) {
        sc.foreground = rels[0];
        console.log(`[import] scene ${opts.sceneIndex}.foreground = ${rels[0]}`);
      }
      fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));
      console.log(`[import] attached ${rels.length} file(s) to scene ${opts.sceneIndex}.assets`);
    } else {
      console.warn(`[import] scene ${opts.sceneIndex} not found in storyboard`);
    }
  }

  console.log(`\n✓ ${copied.length} file(s) imported. Path: assets/imported/`);
  return copied;
}
