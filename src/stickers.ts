/**
 * `pipeline stickers` — prompt list in, matte-cut sticker PNGs out.
 *
 * Chains the two halves of the 小Lin说 collage material line (brief P2):
 *   1. generate a WHITE-BG single subject per prompt (image provider, default
 *      mytokk = gpt-5.5 Responses image tool);
 *   2. matte-cut the white via u2net (npx hyperframes remove-background) →
 *      transparent PNG under assets/stickers/, consumed by hf-sticker-pop.
 *
 * The sticker prompt injects the project's live design palette (印刷工坊 tokens)
 * so every sticker shares the same blood-type as the layout (DIRECTION §〇/§三).
 */

import fs from "node:fs";
import path from "node:path";
import { getImage } from "./providers/registry.ts";
import { writeFileAtomic } from "./fsutil.ts";
import { matteFile } from "./matte.ts";
import { resolveDesign, tokensToPromptPalette } from "./methods/designs.ts";
import type { Storyboard } from "./types.ts";

interface StickersOpts {
  /** Subject prompts, one sticker each (e.g. "a smiling AI robot mascot"). */
  prompts: string[];
  projectRoot: string;
  /** Optional storyboard — used only to resolve the project design for the palette. */
  storyboardPath?: string;
  /** Image provider id. Default "mytokk". */
  provider?: string;
  /** Aspect ratio for the raw generation. Default "3:4" (portrait subject). */
  aspectRatio?: "1:1" | "3:4" | "9:16" | "16:9" | "4:3";
  /** Skip subjects whose matted sticker already exists. */
  force?: boolean;
  /** hyperframes remove-background device: auto/cpu/coreml/cuda. */
  device?: string;
}

function slug(s: string): string {
  return s.replace(/[^\w一-鿿]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "sticker";
}

export async function runStickers(opts: StickersOpts): Promise<string[]> {
  const assetsDir = path.join(opts.projectRoot, "assets");
  const rawDir = path.join(assetsDir, "generated");    // white-bg generations
  const stickerDir = path.join(assetsDir, "stickers"); // matte-cut output
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(stickerDir, { recursive: true });

  // Resolve the project design palette so stickers match the layout's look.
  let design = resolveDesign(undefined); // inkwork default
  if (opts.storyboardPath && fs.existsSync(opts.storyboardPath)) {
    try {
      const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
      design = resolveDesign(sb.project?.design);
    } catch { /* keep default */ }
  }
  const palette = tokensToPromptPalette(design);

  const img = getImage(opts.provider || "mytokk");
  console.log(`[stickers] provider=${img.id}  palette=${palette.slice(0, 70)}…`);

  const outputs: string[] = [];
  const prompts = opts.prompts.map((p) => p.trim()).filter(Boolean);
  for (let i = 0; i < prompts.length; i++) {
    const subject = prompts[i];
    const stem = `sticker-${String(i + 1).padStart(2, "0")}-${slug(subject)}`;
    const rawPath = path.join(rawDir, `${stem}.png`);
    const stickerPath = path.join(stickerDir, `${stem}.matte.png`);

    if (!opts.force && fs.existsSync(stickerPath)) {
      console.log(`[stickers ${i + 1}/${prompts.length}] cache hit — ${path.basename(stickerPath)}`);
      outputs.push(stickerPath);
      continue;
    }

    // White-bg single subject, design palette injected (印刷工坊, no hardcoded hue).
    const prompt =
      `${subject}. Single subject, centered, plain pure white background, flat clean vector ` +
      `illustration with thick confident outlines, generous even margin around the subject. ` +
      `Colour palette: ${palette} Absolutely no text, no logos, no watermark, no drop shadow.`;

    console.log(`[stickers ${i + 1}/${prompts.length}] gen: ${subject.slice(0, 40)}`);
    let buffers: Buffer[];
    try {
      buffers = await img.image({ prompt, aspectRatio: opts.aspectRatio || "3:4", n: 1 });
    } catch (e) {
      console.error(`[stickers ${i + 1}] gen FAILED: ${(e as Error).message}`);
      continue;
    }
    writeFileAtomic(rawPath, buffers[0]);

    console.log(`[stickers ${i + 1}/${prompts.length}] matte (u2net) → assets/stickers/`);
    try {
      // Illustrations/products cut better with the general u2net than the human model.
      matteFile(rawPath, stickerPath, { model: "u2net", device: opts.device });
    } catch (e) {
      console.error(`[stickers ${i + 1}] matte FAILED: ${(e as Error).message}`);
      continue;
    }
    outputs.push(stickerPath);
    console.log(`[stickers ${i + 1}/${prompts.length}] → ${path.relative(opts.projectRoot, stickerPath)}`);
  }

  console.log(`\n✓ ${outputs.length}/${prompts.length} sticker(s) under assets/stickers/  (feed hf-sticker-pop via scene.assets)`);
  return outputs;
}
