/**
 * `pipeline images` — for each scene that wants a background image, generate one
 * via the image provider and write it under `assets/generated/scene-NNN.png`.
 * Updates `scene.assets[]` with the new file path so the renderer can pick it up.
 *
 * Strategy:
 *   - Build a per-scene image prompt from the scene text + the scene's LIVE
 *     design tokens (paper/ink/accent → natural-language palette). Colour comes
 *     from the design system, never hardcoded — so生图 素材 shares the same
 *     blood-type as the layout (DIRECTION §〇).
 *   - Use chat (the same provider used for analyzer) to expand the short
 *     Chinese caption into a richer English-ish visual prompt — yields much
 *     better image generations than passing raw subtitle text directly.
 *   - Then call the image provider.
 *
 * Caches by (scene text + provider + style recipe + resolved palette). Re-runs
 * only fetch scenes whose source or design changed.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getChat, getImage } from "./providers/registry.ts";
import { writeFileAtomic } from "./fsutil.ts";
import { resolveDesign, resolveSceneDesign, tokensToPromptPalette } from "./methods/designs.ts";
import type { Scene, Storyboard } from "./types.ts";

interface ImagesOpts {
  storyboardPath: string;
  assetsDir: string;   // project root assets/ dir (we write under generated/)
  projectRoot: string;
  /** Force regenerate even if cache hit. */
  force: boolean;
  /** Provider id for image generation. Default minimax. */
  provider?: string;
  /** Provider id for the chat call that expands prompts. Default minimax. */
  chatProvider?: string;
  /** Aspect ratio. Default 16:9. */
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  /** Only generate for these scene indices. Default all that don't already have a generated bg. */
  onlyIndices?: number[];
  /** Skip prompt-expansion (use raw scene text as image prompt). Default false. */
  rawPrompts?: boolean;
  /** N candidates per scene. Default 1. Minimax caps at 9. Use 2-3 for previews. */
  candidates?: number;
}

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

/**
 * Per-style recipe: subject + camera + lighting + COMPOSITION only. Colour is
 * injected separately from the scene's live design tokens (see buildScenePrompt),
 * so no recipe may name a hue — that would fight the design system and re-import
 * the banned AI-gold/purple look (DIRECTION §〇, MOTION.md 红线 7). The chat model
 * uses a recipe as a template, fills in the scene-specific subject, and emits an
 * English prompt the image model can interpret without 'prompt_optimizer'
 * rewriting it.
 */
const STYLE_RECIPES: Record<string, string> = {
  cinematic:
    "Cinematic hero shot, anamorphic lens, shallow depth of field, rich shadow contrast, single subject with strong directional key light, leave clear negative space on the right third for text overlay.",
  editorial:
    "Editorial magazine still life, soft natural window light, clean composition with generous negative space, restrained matte grade, photo realism, no text or branding.",
  "abstract-pattern":
    "Abstract graphic composition, non-photographic, repeating geometric or organic shapes, flat matte shading, minimal depth, suitable as a moving background. NO faces, NO objects.",
  "product-hero":
    "Single product/object hero, studio lighting, soft shadow, matte surface, dramatic side light, clear empty space around the subject.",
  "minimal-dark":
    "Minimal low-key background, single very subtle accent, extremely minimal subject (or pure flat tone + fine grain), leaves the foreground completely free for a data chart on top. Photorealistic NOT graphic.",
  "portrait-moody":
    "Close human portrait, dramatic directional lighting, shallow depth, contemplative mood. Face only when the scene explicitly references a person.",
  documentary:
    "Candid documentary still, hand-held feel, natural environmental light, real-world subject, restrained matte grade, no over-saturation.",
  "tech-3d":
    "CGI 3D scene, matte and brushed surfaces, subtle directional rim light, clean studio HDRI, ONE central object, minimal background. Avoid stock cyber-neon city tropes.",
};

const NEGATIVE_PROMPT = "no text, no letters, no typography, no logos, no watermarks, no UI panels, no gradient backgrounds, no glow or bloom, no glossy metallic sheen, no neon cyberpunk cliché, no stock-AI-art holographic interfaces";

/**
 * Build a rich, style-aware image prompt for one scene.
 *
 * Strategy: the chat model gets a TEMPLATE (subject placeholder + style recipe
 * + the scene's live design palette + negative-prompt block) and fills in the
 * scene-specific SUBJECT line. We then assemble the final prompt deterministically
 * — so even if chat returns an empty thinking-only response, we still produce a
 * usable prompt instead of falling back to raw Chinese. `palette` comes from
 * tokensToPromptPalette(resolvedDesign), never a hardcoded hue.
 */
async function buildScenePrompt(
  scene: { text: string; imageStyle?: string },
  palette: string,
  chatProvider?: string
): Promise<string> {
  const style = scene.imageStyle ?? "editorial";
  const recipe = STYLE_RECIPES[style] ?? STYLE_RECIPES.editorial;

  // Ask chat for ONLY the subject — short phrase, English, concrete.
  const chat = getChat(chatProvider);
  const system =
    `You translate a short Chinese subtitle line into the SUBJECT description of an English image prompt (one phrase, 8-18 English words).\n` +
    `Rules:\n` +
    `1. Concrete subject only — what is in frame.\n` +
    `2. NO style words like "cinematic" / "professional" — style is added separately.\n` +
    `3. NO Chinese characters in your output.\n` +
    `4. NO text/letters/UI/logos in the imagined scene.\n` +
    `5. If the caption is too abstract (e.g. "we compare 3 dimensions"), invent a CONCRETE visual metaphor (e.g. "three glass spheres on a dark surface").\n` +
    `6. Output the subject phrase only — no quotes, no prose, no period.`;
  let subject = "";
  try {
    const reply = await chat.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: scene.text },
      ],
      // M2.7-highspeed uses <think> blocks that consume 200-400 tokens before
      // emitting actual output. 80 tokens → think eats them all → empty reply.
      // 800 gives reliable room to think AND answer.
      maxTokens: 800,
      temperature: 0.7,
    });
    const first = reply.split(/\r?\n/).find((l) => l.trim());
    if (first) subject = first.replace(/^["'""]+|["'""]+$/g, "").replace(/[.。]$/, "").trim();
  } catch (e) {
    // fall through — we'll use a procedural subject
  }
  if (!subject || /[一-鿿]/.test(subject)) {
    // Procedural fallback when chat returns empty or still-Chinese.
    // Build subject from style alone — generic but at least style-appropriate.
    subject = ({
      cinematic: "wide dramatic landscape at dusk",
      editorial: "single still-life object on a clean surface",
      "abstract-pattern": "abstract geometric composition",
      "product-hero": "polished hero object on a dark plinth",
      "minimal-dark": "empty dark gradient with subtle grain",
      "portrait-moody": "shadowed figure in a dim room",
      documentary: "candid environmental moment",
      "tech-3d": "single floating polished sphere",
    } as Record<string, string>)[style];
  }

  // Assemble the final prompt deterministically. Order matters for many image
  // models — front-load the most important style/subject info, then technicals.
  return [
    `${subject}.`,
    recipe,
    `Colour palette (follow exactly): ${palette}`,
    `Aspect: 16:9 widescreen. High-end photography, intentional composition, 4K, real lens.`,
    `Avoid: ${NEGATIVE_PROMPT}.`,
  ].join(" ");
}

export async function runImages(opts: ImagesOpts): Promise<void> {
  const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
  const generatedDir = path.join(opts.assetsDir, "generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  const imageClient = getImage(opts.provider);
  console.log(`[images] provider=${imageClient.id}  aspect=${opts.aspectRatio ?? "16:9"}`);
  console.log(`[images] project palette: ${tokensToPromptPalette(resolveDesign(sb.project?.design)).slice(0, 90)}…`);

  const targetIndices = new Set(opts.onlyIndices ?? sb.scenes.map((s) => s.index));

  for (const sc of sb.scenes) {
    if (!targetIndices.has(sc.index)) continue;

    const promptSeed = sc.text;
    // Palette is resolved per scene: scene.style can override the project design,
    // and the 整体设计 panel lets users tweak paper/ink/accent — any of those must
    // re-generate, so the palette string goes into the cache key.
    const palette = tokensToPromptPalette(resolveSceneDesign(sb.project?.design, sc.style));
    // imageStyle selects among 8 very different STYLE_RECIPES that dominate the
    // prompt, so it MUST be in the cache key — otherwise switching a scene's style
    // (a user-editable knob) would silently keep the old image.
    const hash = sha1(`${promptSeed}|${imageClient.id}|${opts.aspectRatio ?? "16:9"}|${sc.imageStyle ?? "editorial"}|${palette}`);
    const filename = `scene-${String(sc.index).padStart(3, "0")}.${hash}.png`;
    const absPath = path.join(generatedDir, filename);
    const relFromRoot = path.relative(opts.projectRoot, absPath);
    const relFromAssets = path.relative(opts.assetsDir, absPath);

    if (!opts.force && fs.existsSync(absPath)) {
      console.log(`[scene ${sc.index}] image cache hit — '${promptSeed.slice(0, 28)}…'`);
      ensureAssetRef(sc, relFromAssets, false);
      continue;
    }

    // 1) Build a rich, style-aware English prompt (or skip if --raw).
    let prompt: string;
    if (opts.rawPrompts) {
      prompt = promptSeed;
    } else {
      try {
        prompt = await buildScenePrompt(
          { text: promptSeed, imageStyle: sc.imageStyle },
          palette,
          opts.chatProvider
        );
      } catch (e) {
        console.warn(`[scene ${sc.index}] prompt build failed (${(e as Error).message}); using raw text`);
        prompt = promptSeed;
      }
    }
    const styleLabel = sc.imageStyle ?? "(default)";
    console.log(`[scene ${sc.index}] style=${styleLabel}`);
    console.log(`[scene ${sc.index}] prompt: ${prompt.slice(0, 140)}${prompt.length > 140 ? "…" : ""}`);

    // 2) Generate — request N candidates so the user can pick the best one.
    const n = opts.candidates ?? 1;
    try {
      const buffers = await imageClient.image({
        prompt,
        aspectRatio: opts.aspectRatio ?? "16:9",
        n,
      });
      if (!buffers.length) throw new Error("no image bytes");
      // Primary: first candidate. Alternates: scene-NNN.alt-1.png, .alt-2.png, etc.
      // Write atomically (temp + rename): a crash mid-write must not leave a
      // truncated PNG at absPath, which existsSync would then cache-hit forever.
      writeFileAtomic(absPath, buffers[0]);
      ensureAssetRef(sc, relFromAssets, true);
      console.log(`[scene ${sc.index}] → ${relFromRoot}  (${(buffers[0].length / 1024).toFixed(0)} KB${n > 1 ? `, primary of ${n}` : ""})`);
      for (let i = 1; i < buffers.length; i++) {
        const altName = `scene-${String(sc.index).padStart(3, "0")}.${hash}.alt-${i}.png`;
        const altAbs = path.join(generatedDir, altName);
        writeFileAtomic(altAbs, buffers[i]);
      }
    } catch (e) {
      console.error(`[scene ${sc.index}] image FAILED: ${(e as Error).message}`);
    }
  }

  fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));
  console.log(`\n✓ images written under ${path.relative(process.cwd(), generatedDir)}`);
  console.log(`✓ storyboard updated with scene.assets entries`);
}

/**
 * Attach the generated background ref WITHOUT silently reverting the user's
 * curation. The scene's assets[0] is what the renderer picks, so a hand-chosen
 * alternate candidate (`generated/…alt-N.png`), a stock photo attached via
 * `pipeline fetch`, or an already-present generated ref must survive a re-run.
 *
 * `regenerated` = this run actually produced a new file (vs a cache hit). On a
 * cache hit we never touch a curated scene; on a real regen we refresh the
 * generated ref but still never demote a user's non-generated image at the top.
 */
function ensureAssetRef(scene: Scene, relPath: string, regenerated: boolean): void {
  scene.assets = scene.assets ?? [];
  const isImage = (a: string) => /\.(png|jpe?g|webp)$/i.test(a);
  const hasGenerated = scene.assets.some((a) => a.startsWith("generated/"));
  const userImageAtTop = scene.assets.length > 0 && isImage(scene.assets[0]) && !scene.assets[0].startsWith("generated/");

  if (!regenerated) {
    // Cache hit — leave any existing curation (generated ref, alt, or stock) intact.
    if (hasGenerated || userImageAtTop) return;
    scene.assets.unshift(relPath);
    return;
  }
  // Freshly (re)generated. Replace the generated ref, but keep a user's
  // non-generated image (e.g. stock photo) as the primary if they set one.
  scene.assets = scene.assets.filter((a) => !a.startsWith("generated/"));
  if (userImageAtTop) scene.assets.push(relPath);
  else scene.assets.unshift(relPath);
}
