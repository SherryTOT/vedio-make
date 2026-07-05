/**
 * `pipeline translate <target-lang>` — translate the storyboard's scene texts
 * to another language via the chat provider. Produces:
 *
 *   output/storyboard.<lang>.json   — copy of storyboard with translated `text`
 *   output/source.<lang>.srt        — translated SRT (for re-render or subtitle sidecar)
 *
 * Translation is batched into a single chat call to preserve narrative
 * consistency across scenes. The model is asked to keep technical terms
 * (npm, GSAP, etc.) untouched and to match the source line's tone.
 *
 * After translate, you can:
 *   - `pipeline tts --in output/storyboard.<lang>.json --voice <localized>`  → multi-lang voiceover
 *   - render with `--in output/storyboard.<lang>.json` (when render supports it)
 *   - bundle multiple language SRTs as sidecars next to one MP4
 */

import fs from "node:fs";
import path from "node:path";
import { getChat } from "./providers/registry.ts";
import type { Storyboard } from "./types.ts";

const LANG_LABEL: Record<string, string> = {
  en: "English",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  fr: "French (Français)",
  es: "Spanish (Español)",
  de: "German (Deutsch)",
  pt: "Portuguese (Português)",
  ru: "Russian (Русский)",
  zh: "Simplified Chinese (简体中文)",
  "zh-tw": "Traditional Chinese (繁體中文)",
  th: "Thai (ไทย)",
  vi: "Vietnamese (Tiếng Việt)",
  id: "Indonesian (Bahasa Indonesia)",
  ar: "Arabic (العربية)",
};

interface TranslateOpts {
  storyboardPath: string;
  outputDir: string;
  /** Target lang code, e.g. "en", "ja", "zh-tw". */
  targetLang: string;
  /** Optional: source lang code as a hint. Default "auto-detect from text". */
  sourceLang?: string;
  provider?: string;
  /** Force re-translate even if storyboard.<lang>.json exists. */
  force?: boolean;
}

function buildPrompt(sb: Storyboard, target: string, source?: string): { system: string; user: string } {
  const targetLabel = LANG_LABEL[target] ?? target;
  const sourceHint = source && LANG_LABEL[source] ? ` from ${LANG_LABEL[source]}` : "";
  const system = `You translate video subtitle scenes${sourceHint} to ${targetLabel}.

Rules:
1. Preserve narrative tone — if the source is conversational, the translation is conversational.
2. Keep brand names, code identifiers, version numbers, units, and English technical terms UNTRANSLATED. (e.g. "GSAP", "npm", "Framer Motion", "iOS 18", "1080p")
3. Match the source length within ±30 chars when reasonable — the translation will be voiced over with the same timing.
4. Avoid line breaks WITHIN a translated cue. One scene = one continuous sentence/phrase.
5. Output VALID JSON ONLY, no prose around it. Structure:
{
  "scenes": [
    {"index": 1, "text": "translated text for scene 1"},
    {"index": 2, "text": "translated text for scene 2"},
    ...
  ]
}`;
  const lines = sb.scenes
    .map((s) => `  ${String(s.index).padStart(2, "0")}. [${s.durationSec.toFixed(1)}s] ${JSON.stringify(s.text)}`)
    .join("\n");
  const user = `Project: ${sb.project.title}
Target language: ${targetLabel}
${sb.scenes.length} scenes:

${lines}

Translate all scenes. Return JSON now.`;
  return { system, user };
}

function unfence(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) out = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  return out.replace(/^(?:json|response|output)\s*:\s*/i, "").trim();
}

function srtTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export async function runTranslate(opts: TranslateOpts): Promise<void> {
  const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
  const outSb = path.join(opts.outputDir, `storyboard.${opts.targetLang}.json`);
  const outSrt = path.join(opts.outputDir, `source.${opts.targetLang}.srt`);

  if (!opts.force && fs.existsSync(outSb)) {
    console.log(`[translate] cache hit — ${path.relative(process.cwd(), outSb)} exists (--force to regenerate)`);
    return;
  }

  const chat = getChat(opts.provider);
  const { system, user } = buildPrompt(sb, opts.targetLang, opts.sourceLang);
  console.log(`[translate] provider=${chat.id}  →  ${LANG_LABEL[opts.targetLang] ?? opts.targetLang}  (${sb.scenes.length} scenes)`);

  const reply = await chat.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 4096,
    temperature: 0.3,
  });

  let parsed: { scenes: Array<{ index: number; text: string }> };
  try {
    parsed = JSON.parse(unfence(reply));
  } catch (e) {
    throw new Error(`translation returned invalid JSON: ${reply.slice(0, 300)}…\nParse error: ${(e as Error).message}`);
  }
  const byIdx = new Map(parsed.scenes.map((s) => [s.index, s.text]));

  // Build translated storyboard (deep-copy + replace text + bump lang marker)
  const translated: Storyboard = JSON.parse(JSON.stringify(sb));
  translated.project.title = `${sb.project.title}  [${opts.targetLang.toUpperCase()}]`;
  let missing = 0;
  for (const sc of translated.scenes) {
    const t = byIdx.get(sc.index);
    if (!t) { missing++; continue; }
    sc.text = t.trim();
    if (sc.cues?.length) {
      sc.cues = sc.cues.map((c, i) => i === 0 ? { ...c, text: t.trim() } : c);
    }
  }
  if (missing > 0) {
    // A truncated reply left some scenes untranslated. Writing the CACHEABLE
    // storyboard.<lang>.json would freeze a mixed-language board that every later
    // run treats as a cache hit (line ~102) → poisons downstream tts/render.
    // Write a clearly-partial file and fail loudly so the user re-runs instead.
    const partial = path.join(opts.outputDir, `storyboard.${opts.targetLang}.partial.json`);
    fs.writeFileSync(partial, JSON.stringify(translated, null, 2));
    throw new Error(
      `翻译不完整:${missing}/${sb.scenes.length} 个镜头未翻译(模型回复可能被截断)。` +
      `已存为 ${path.relative(process.cwd(), partial)}(不当缓存);请重跑 \`pipeline translate --force\`(长稿建议分批)。`,
    );
  }

  fs.writeFileSync(outSb, JSON.stringify(translated, null, 2));

  // Sidecar SRT
  const srtLines: string[] = [];
  let idx = 1;
  for (const sc of translated.scenes) {
    srtLines.push(`${idx++}`, `${srtTimestamp(sc.startSec)} --> ${srtTimestamp(sc.endSec)}`, sc.text, "");
  }
  fs.writeFileSync(outSrt, srtLines.join("\n"));

  console.log(`✓ Translated ${sb.scenes.length - missing}/${sb.scenes.length} scenes → ${path.relative(process.cwd(), outSb)}`);
  console.log(`✓ SRT sidecar → ${path.relative(process.cwd(), outSrt)}`);
  if (missing) console.warn(`⚠ ${missing} scene(s) missing in model output`);
  console.log(`\n  Next: pipeline tts --in ${path.relative(process.cwd(), outSb)} --voice <localized>`);
  console.log(`        pipeline render --in ${path.relative(process.cwd(), outSb)}`);
}
