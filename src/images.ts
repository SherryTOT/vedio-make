/**
 * `pipeline images` — for each scene that wants a background image, generate one
 * via the image provider and write it under `assets/generated/scene-NNN.png`.
 * Updates `scene.assets[]` with the new file path so the renderer can pick it up.
 *
 * Strategy:
 *   - Build a per-scene image prompt from the scene text + design.md tone.
 *   - Use chat (the same provider used for analyzer) to expand the short
 *     Chinese caption into a richer English-ish visual prompt — yields much
 *     better image generations than passing raw subtitle text directly.
 *   - Then call the image provider.
 *
 * Caches by (scene text + provider + design mood hash). Re-runs only fetch
 * scenes whose source changed.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getChat, getImage } from "./providers/registry.ts";
import type { Scene, Storyboard } from "./types.ts";

interface ImagesOpts {
  storyboardPath: string;
  assetsDir: string;   // project root assets/ dir (we write under generated/)
  designPath: string;
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
 * Per-style recipe: subject + camera + lighting + color hints. The chat model
 * uses these as a template, fills in scene-specific subject, and emits an
 * English prompt that the image model can interpret without 'prompt_optimizer'
 * rewriting it.
 */
const STYLE_RECIPES: Record<string, string> = {
  cinematic:
    "Cinematic hero shot, anamorphic lens, shallow depth of field, rich shadow contrast, deep purple and gold color grading, single subject with strong rim light, leave clear negative space on the right third for text overlay.",
  editorial:
    "Editorial magazine still life, soft natural window light, clean composition with generous negative space, restrained color palette (dark backdrop, one cream/gold accent), photo realism, no text or branding.",
  "abstract-pattern":
    "Abstract graphic composition, non-photographic, repeating geometric or organic shapes in deep purple and gold gradient, brand-coherent flat shading, minimal depth, suitable as a moving background. NO faces, NO objects.",
  "product-hero":
    "Single product/object hero, studio lighting on dark backdrop, soft shadow, polished surface, dramatic side light, deep purple background gradient with gold highlight, clear empty space around the subject.",
  "minimal-dark":
    "Near-black background, single very subtle accent color (deep purple or gold dust), extremely minimal subject (or pure gradient + grain), leaves the foreground completely free for a data chart on top. Photorealistic NOT graphic.",
  "portrait-moody":
    "Close human portrait, warm-cool dramatic lighting, shallow depth, melancholic mood, dark background. Face only when the scene explicitly references a person.",
  documentary:
    "Candid documentary still, hand-held feel, natural environmental light, real-world subject, color grade leans warm but restrained, no over-saturation.",
  "tech-3d":
    "CGI 3D scene, polished glass and brushed metal surfaces, subtle neon rim light in purple and gold, clean studio HDRI, ONE central object, minimal background. Avoid stock cyber-neon city tropes.",
};

const NEGATIVE_PROMPT = "no text, no letters, no typography, no logos, no watermarks, no UI panels, no neon blue/pink cyberpunk cliché, no stock-AI-art holographic interfaces";

/**
 * Build a rich, style-aware image prompt for one scene.
 *
 * Strategy: the chat model gets a TEMPLATE (subject placeholder + style recipe
 * + design.md palette + negative-prompt block) and fills in the scene-specific
 * SUBJECT line. We then assemble the final prompt deterministically — so even
 * if chat returns an empty thinking-only response, we still produce a usable
 * prompt instead of falling back to raw Chinese.
 */
async function buildScenePrompt(
  scene: { text: string; imageStyle?: string },
  designSummary: string,
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
    `Color palette from this brand system: ${designSummary.slice(0, 240).replace(/\s+/g, " ")}`,
    `Aspect: 16:9 widescreen. High-end photography, intentional composition, 4K, real lens.`,
    `Avoid: ${NEGATIVE_PROMPT}.`,
  ].join(" ");
}

function designSummaryFromMd(designMd: string): string {
  // Extract palette + mood for the chat prompt — keeps the system message short.
  const palette = designMd.match(/##\s*Palette[\s\S]*?(?=\n##|$)/i)?.[0] ?? "";
  const motion = designMd.match(/##\s*Motion[\s\S]*?(?=\n##|$)/i)?.[0] ?? "";
  const summary = (palette + "\n" + motion).slice(0, 800);
  return summary || "deep purple + gold accents, cream text, cinematic dark";
}

export async function runImages(opts: ImagesOpts): Promise<void> {
  const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
  const generatedDir = path.join(opts.assetsDir, "generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  const designMd = fs.existsSync(opts.designPath)
    ? fs.readFileSync(opts.designPath, "utf8")
    : "";
  const designSummary = designSummaryFromMd(designMd);

  const imageClient = getImage(opts.provider);
  console.log(`[images] provider=${imageClient.id}  aspect=${opts.aspectRatio ?? "16:9"}`);
  console.log(`[images] design hint: ${designSummary.slice(0, 80).replace(/\n/g, " ")}…`);

  const targetIndices = new Set(opts.onlyIndices ?? sb.scenes.map((s) => s.index));

  for (const sc of sb.scenes) {
    if (!targetIndices.has(sc.index)) continue;

    const promptSeed = sc.text;
    const hash = sha1(`${promptSeed}|${imageClient.id}|${opts.aspectRatio ?? "16:9"}|${designSummary.slice(0, 200)}`);
    const filename = `scene-${String(sc.index).padStart(3, "0")}.${hash}.png`;
    const absPath = path.join(generatedDir, filename);
    const relFromRoot = path.relative(opts.projectRoot, absPath);
    const relFromAssets = path.relative(opts.assetsDir, absPath);

    if (!opts.force && fs.existsSync(absPath)) {
      console.log(`[scene ${sc.index}] image cache hit — '${promptSeed.slice(0, 28)}…'`);
      ensureAssetRef(sc, relFromAssets);
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
          designSummary,
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
      fs.writeFileSync(absPath, buffers[0]);
      ensureAssetRef(sc, relFromAssets);
      console.log(`[scene ${sc.index}] → ${relFromRoot}  (${(buffers[0].length / 1024).toFixed(0)} KB${n > 1 ? `, primary of ${n}` : ""})`);
      for (let i = 1; i < buffers.length; i++) {
        const altName = `scene-${String(sc.index).padStart(3, "0")}.${hash}.alt-${i}.png`;
        const altAbs = path.join(generatedDir, altName);
        fs.writeFileSync(altAbs, buffers[i]);
      }
    } catch (e) {
      console.error(`[scene ${sc.index}] image FAILED: ${(e as Error).message}`);
    }
  }

  fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));
  console.log(`\n✓ images written under ${path.relative(process.cwd(), generatedDir)}`);
  console.log(`✓ storyboard updated with scene.assets entries`);
}

function ensureAssetRef(scene: Scene, relPath: string): void {
  scene.assets = scene.assets ?? [];
  // Remove any previous generated background ref for this scene
  scene.assets = scene.assets.filter((a) => !a.startsWith("generated/"));
  scene.assets.unshift(relPath);
}
