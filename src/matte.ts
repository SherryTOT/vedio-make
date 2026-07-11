/**
 * `pipeline matte` — chroma key / background removal.
 *
 * Calls `npx hyperframes remove-background` under the hood (u2net AI model,
 * runs locally — no API quota). Produces transparent PNGs in assets/matted/
 * and optionally writes scene.foreground references back to the storyboard.
 *
 * Usage:
 *   pipeline matte <input.png>                       — one-off, prints output path
 *   pipeline matte --asset <relative-path>           — process an asset, store under assets/matted/
 *   pipeline matte --all-generated                   — batch process every assets/generated/*.png
 *   pipeline matte --scene N --asset <p>             — also write scene N.foreground = matted path
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Scene, Storyboard } from "./types.ts";

interface MatteOpts {
  /** A single input path (absolute or relative to cwd). */
  inputPath?: string;
  /** A path relative to assets/ — implies output goes under assets/matted/. */
  assetPath?: string;
  /** Batch: process every PNG under assets/generated/. */
  allGenerated?: boolean;
  /** Optional scene index — also write scene.foreground = <output rel> after matting. */
  sceneIndex?: number;
  /** Project root */
  projectRoot: string;
  /** Path to storyboard.json (only needed if sceneIndex is set, or for --auto) */
  storyboardPath?: string;
  /** Force re-matte even if output exists. */
  force?: boolean;
  /** Pass through to hyperframes: cpu / coreml / cuda / auto. */
  device?: string;
  /**
   * Auto mode — walk the storyboard and matte every scene flagged
   * `needsMatting: true` that has a source image asset. Set scene.foreground.
   */
  auto?: boolean;
}

function runHfMatte(input: string, output: string, device = "auto"): void {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const args = ["--yes", "hyperframes@0.5.7", "remove-background", input, "-o", output, "--device", device];
  console.log(`[matte] npx ${args.join(" ")}`);
  const r = spawnSync("npx", args, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`hyperframes remove-background failed (exit ${r.status})`);
  }
}

/** Same as runHfMatte but passes an explicit segmentation model. */
function runHfMatteModel(input: string, output: string, device: string, model: string): void {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const args = ["--yes", "hyperframes@0.5.7", "remove-background", input, "-o", output, "--device", device, "--model", model];
  console.log(`[matte] npx ${args.join(" ")}`);
  const r = spawnSync("npx", args, { stdio: "inherit" });
  if (r.status !== 0) {
    // Some hyperframes versions may not support --model; retry without it.
    console.warn(`[matte] --model ${model} failed (exit ${r.status}); retrying with default model`);
    runHfMatte(input, output, device);
  }
}

/** Matte a single file to an explicit output path (u2net). Reused by `pipeline stickers`. */
export function matteFile(input: string, output: string, opts: { model?: string; device?: string } = {}): void {
  if (opts.model) runHfMatteModel(input, output, opts.device || "auto", opts.model);
  else runHfMatte(input, output, opts.device || "auto");
}

function matteOne(absInput: string, opts: MatteOpts, mattedDir: string): string {
  const base = path.basename(absInput, path.extname(absInput));
  const outAbs = path.join(mattedDir, `${base}.matte.png`);
  if (!opts.force && fs.existsSync(outAbs)) {
    console.log(`[matte] cache hit — ${path.basename(outAbs)}`);
    return outAbs;
  }
  runHfMatte(absInput, outAbs, opts.device || "auto");
  return outAbs;
}

/** Map analyzer mattingHint → hyperframes remove-background model. */
function modelForHint(hint?: string): string {
  // hyperframes default is u2net_human_seg. For non-human subjects the
  // general u2net does much better. (hyperframes exposes --model)
  if (hint === "object" || hint === "product") return "u2net";
  return "u2net_human_seg";
}

export async function runMatte(opts: MatteOpts): Promise<string[]> {
  const assetsDir = path.join(opts.projectRoot, "assets");
  const mattedDir = path.join(assetsDir, "matted");
  fs.mkdirSync(mattedDir, { recursive: true });

  // ─── AUTO MODE ────────────────────────────────────────────────────────
  // Walk the storyboard, matte every scene flagged needsMatting that has a
  // usable source image, and write scene.foreground.
  if (opts.auto) {
    if (!opts.storyboardPath || !fs.existsSync(opts.storyboardPath)) {
      throw new Error("--auto needs output/storyboard.json (run plan + analyze first)");
    }
    const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
    const flagged = sb.scenes.filter((s) => s.needsMatting);
    if (!flagged.length) {
      console.log("[matte --auto] no scenes flagged needsMatting — nothing to do.");
      return [];
    }
    console.log(`[matte --auto] ${flagged.length} scene(s) flagged needsMatting:`);
    const outs: string[] = [];
    for (const sc of flagged) {
      // Find a usable source image in scene.assets (any image file).
      const srcRel = (sc.assets ?? []).find((a) => /\.(png|jpg|jpeg|webp)$/i.test(a));
      if (!srcRel) {
        console.warn(`   · scene ${sc.index}: needsMatting but NO source image in assets — skipped (provide a portrait/subject image, or run 'pipeline images')`);
        continue;
      }
      const srcAbs = path.resolve(assetsDir, srcRel);
      if (!fs.existsSync(srcAbs)) {
        console.warn(`   · scene ${sc.index}: source ${srcRel} not found — skipped`);
        continue;
      }
      const model = modelForHint(sc.mattingHint);
      console.log(`   · scene ${sc.index}: matting ${srcRel}  (hint=${sc.mattingHint ?? "human"}, model=${model})`);
      const base = path.basename(srcAbs, path.extname(srcAbs));
      const outAbs = path.join(mattedDir, `${base}.matte.png`);
      if (opts.force || !fs.existsSync(outAbs)) {
        runHfMatteModel(srcAbs, outAbs, opts.device || "auto", model);
      } else {
        console.log(`     cache hit — ${path.basename(outAbs)}`);
      }
      const relFromAssets = path.relative(assetsDir, outAbs);
      sc.foreground = relFromAssets;
      outs.push(outAbs);
    }
    fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));
    console.log(`\n✓ matted ${outs.length} scene(s); scene.foreground written. Re-render to composite.`);
    return outs;
  }

  const inputs: string[] = [];

  if (opts.allGenerated) {
    const generatedDir = path.join(assetsDir, "generated");
    if (!fs.existsSync(generatedDir)) {
      throw new Error(`No assets/generated/ folder — run 'pipeline images' first.`);
    }
    for (const f of fs.readdirSync(generatedDir)) {
      if (/\.(png|jpg|jpeg|webp)$/i.test(f)) inputs.push(path.join(generatedDir, f));
    }
  }
  if (opts.assetPath) inputs.push(path.resolve(assetsDir, opts.assetPath));
  if (opts.inputPath) inputs.push(path.resolve(opts.projectRoot, opts.inputPath));

  if (!inputs.length) {
    throw new Error("No inputs. Pass --asset <path>, --all-generated, or a positional input path.");
  }

  console.log(`[matte] ${inputs.length} image(s) → assets/matted/`);
  const outputs: string[] = [];
  for (const inp of inputs) {
    if (!fs.existsSync(inp)) {
      console.warn(`[matte] skip (not found): ${inp}`);
      continue;
    }
    const outAbs = matteOne(inp, opts, mattedDir);
    outputs.push(outAbs);
  }

  // Optionally update scene.foreground for a specific scene.
  if (opts.sceneIndex != null && opts.storyboardPath && outputs.length) {
    const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
    const sc = sb.scenes.find((s: Scene) => s.index === opts.sceneIndex);
    if (sc) {
      const relFromAssets = path.relative(assetsDir, outputs[0]);
      sc.foreground = relFromAssets;
      fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));
      console.log(`[matte] wrote scene.foreground = ${relFromAssets} on scene ${opts.sceneIndex}`);
    } else {
      console.warn(`[matte] scene ${opts.sceneIndex} not found in storyboard`);
    }
  }

  console.log(`\n✓ ${outputs.length} matted image(s) under assets/matted/`);
  return outputs;
}
