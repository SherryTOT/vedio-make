/**
 * `pipeline analyze` — auto-picks `method` / `fallback` / `reasoning` / `assets`
 * for every scene in storyboard.json by sending one Minimax chat call with:
 *   • the method catalog (whenToUse, reliability, inputs, assetNeeds)
 *   • design.md (brand mood / palette)
 *   • assets/ directory listing
 *   • all scenes (text + duration)
 *
 * The model returns JSON keyed by scene index. We validate that every chosen
 * method id exists in the catalog and that every fallback has reliability=S,
 * then write the result back to storyboard.json.
 *
 * One call covers all scenes — avoids N round-trips and lets the model see
 * the full narrative arc when picking methods (so it can vary the style
 * across scenes instead of repeating the same method everywhere).
 */

import fs from "node:fs";
import path from "node:path";
import { getChat } from "./providers/registry.ts";
import type { ChangeEntry, MethodDef, Storyboard } from "./types.ts";

interface AnalyzeOpts {
  storyboardPath: string;
  catalogPath: string;
  designPath: string;
  assetsDir: string;
  projectRoot: string;
  /** If true, only re-pick scenes where method is null. Default false (re-pick all). */
  fillOnly: boolean;
  provider?: string;
}

interface AnalyzerScenePick {
  index: number;
  method: string;
  fallback: string;
  reasoning: string;
  assets?: string[];
  notes?: string[];
  motion?: {
    kind: "kenburns" | "dolly" | "pan" | "still";
    direction?: "in" | "out" | "left" | "right" | "up" | "down";
    intensity?: "subtle" | "medium" | "strong";
    ease?: string;
  };
  focus?: {
    kind: "vignette" | "spotlight" | "dof";
    x?: number;
    y?: number;
    radius?: number;
    dim?: number;
  };
  transition?: "cut" | "fade" | "dip-to-black" | "wipe-left" | "wipe-right" | "push-up";
  transitionDur?: number;
  voice?: string;
  burnSubtitle?: boolean;
  imageStyle?: "cinematic" | "editorial" | "abstract-pattern" | "product-hero" | "minimal-dark" | "portrait-moody" | "documentary" | "tech-3d";
  needsMatting?: boolean;
  mattingHint?: "human" | "object" | "product";
}

interface AnalyzerOutput {
  scenes: AnalyzerScenePick[];
}

function listAssets(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else out.push(rel);
    }
  };
  walk(dir, "");
  return out.sort();
}

function buildSystemPrompt(catalog: { methods: MethodDef[] }, designMd: string): string {
  // Compact method list: just the fields the analyzer needs to decide.
  const methodSummary = catalog.methods
    .map(
      (m) =>
        `  ${m.id} (engine=${m.engine}, reliability=${m.reliability})\n` +
        `    whenToUse: ${m.whenToUse}\n` +
        `    inputs: [${m.inputs.join(", ")}]   assetNeeds: [${m.assetNeeds.join(", ") || "none"}]\n` +
        `    tags: [${m.tags.join(", ")}]   fallback: ${m.fallback ?? "—"}`
    )
    .join("\n\n");

  return `You are the analyzer step of a video-generation pipeline. For each subtitle scene the user gives you, pick ONE method from the catalog that best fits the scene's content, narrative role, and duration.

═══════════════════════════════════════════════════════════════════
METHOD CATALOG (pick "method" from these ids, must match verbatim):
═══════════════════════════════════════════════════════════════════
${methodSummary}

═══════════════════════════════════════════════════════════════════
DESIGN GUIDANCE (project brand, mood, palette — for context only):
═══════════════════════════════════════════════════════════════════
${designMd}

═══════════════════════════════════════════════════════════════════
RULES (must follow):
═══════════════════════════════════════════════════════════════════
1. "method" must be one of the catalog ids above (exact string).
2. "fallback" must reference a method with reliability=S (safe fallback when the primary is risky or assets missing). Default "hf-css-fade".
3. Prefer S-tier methods. Use A/B-tier only when its strengths clearly match the scene.
4. Pick variety across the full scene set — avoid using the same method on 8+ consecutive scenes. Hero/section/data/list/comparison/CTA scenes each have natural fits.
5. Heuristics:
   - Short hero/hook (≤10 chars, opening/closing/section titles) → hf-kinetic-text
   - Comma-delimited list of 3+ named items → hf-anime-scatter
   - Numeric comparison of 3-10 items → rm-d3-bar-chart
   - Time series / trend over years → rm-d3-line-trend
   - Highlight a single phrase / fact → hf-waapi-marker
   - 2-5 named alternatives or product cards → rm-framer-card-stack
   - Plain narration / connective tissue → hf-css-fade

6. ALSO emit "motion" and "focus" for each scene to drive non-linear camera and dimming overlays. Rules:
   • motion.kind: kenburns | dolly | pan | still
     - duration ≥ 4s with a likely image background → kenburns (slow zoom)
     - duration ≥ 6s narrative → kenburns with direction:in, intensity:subtle
     - hero/title scenes (kinetic-text, ≤3s) → still (no motion, text shouldn't ride a moving camera)
     - data scenes (rm-d3-*) → still (charts shouldn't drift)
     - dramatic moments → dolly + direction:in + intensity:medium
   • motion.intensity: subtle (~6% scale change) / medium (~14%) / strong (~22%)
   • motion.ease: ALWAYS non-linear. Pick from "power2.inOut", "power3.inOut", "expo.inOut", "sine.inOut". NEVER use "linear" or "none".
   • focus.kind: vignette | spotlight | dof | null/omit
     - rm-d3-* / rm-framer-* / data screens → vignette (edge dim ~0.30)
     - hf-waapi-marker emphasizing a phrase → spotlight at center, dim 0.55
     - kinetic hero text → omit focus (no dim)
     - cards/lists → vignette light (dim 0.20)
   • focus.x / focus.y default to 0.5/0.5 (center). For "Framer Motion 涨幅最猛" type lines, place the spotlight where the phrase visually lands.
   • focus.radius: 0.25 (tight) - 0.55 (loose)

7. Also emit "transition" for each scene (the transition INTO this scene from the previous one):
   • "cut" — same logical beat continues from previous scene (default for most narrative connective tissue).
   • "fade" — soft crossfade at chapter/topic shifts (e.g., entering Scene 5 "维度一" after the list scene).
   • "dip-to-black" — strong reset, mainly between major sections or after a punchline.
   • "wipe-left" / "wipe-right" / "push-up" — directional, for energetic transitions (e.g., entering a card stack).
   • Scene 1 transition is ignored (it's the opening). Use "cut" anyway.
   • "transitionDur" optional, default 0.4s for fade/wipe, 0.6s for dip-to-black.

8. Also emit "voice" — actively use voice variety to keep the audio engaging.
   Project default is "presenter_male" — pick a DIFFERENT voice when:
   • Narrative shifts from explanation → emotional / personal anecdote → use "audiobook_male_1" (deep, calm) or "female-chengshu" (warm).
   • Quoting someone or stating a contrasting opinion → swap gender ("presenter_female") to mark the shift.
   • Hook openers (scene 1) and closers (last scene) — keep default for consistency.
   • Data/chart scenes → keep default (don't distract from the numbers).
   • Lists / catalog scenes (anime-scatter, comma-delim) → "male-qn-jingying" (crisp / business) feels appropriate.
   • Hero kinetic-text section titles → "presenter_female" if the rest is male, to mark chapter break.

   Aim for 2-4 voice changes across a 60+ second video — variety, not chaos. Available voice ids:
   • "presenter_male" (default, podcast tone)
   • "presenter_female" (warm, podcast)
   • "male-qn-jingying" (精英男 — crisp business)
   • "male-qn-qingse" (青年男声 — youthful)
   • "audiobook_male_1" (深沉男 — narration, dramatic)
   • "audiobook_female_1" (有声书女 — narration)
   • "female-shaonv" (少女 — bright, energetic)
   • "female-yujie" (御姐 — mature)
   • "female-chengshu" (成熟女 — warm)
   Output empty/null only when default fits perfectly.

9. Also emit "burnSubtitle": boolean. true means burn the cue text as a caption strip on top of the rendered video.
   • DEFAULT FALSE — most scenes already show their text via the method itself.
   • Set true ONLY when method is "rm-d3-*" (data charts) AND the cue text adds context the chart doesn't show.

9.4. Also emit "needsMatting" and "mattingHint" to control background-removal/compositing:

   needsMatting = true when the scene has ONE clear hero subject that should pop off
   its background. Be GENEROUS here — these patterns almost always want matting:
   • Person intro / reference: "认识…创始人", "他/她…", "我们的团队", a named individual,
     anyone whose face/figure should anchor the frame → mattingHint:"human"
   • Product reveal: "这就是…", "一台…", "全新的…", "introducing…", a single device /
     gadget / object being shown off → mattingHint:"product"
   • A single creature / vehicle / prop that is the literal subject of the line
     ("一只…", "那辆…") → mattingHint:"object"
   • Any "look at THIS [thing/person]" hero beat where a cut-out subject over a
     contextual background reads better than a flat photo

   needsMatting = false (DEFAULT) for:

   needsMatting = false (DEFAULT) for:
   • Pure text scenes (kinetic-text hero with no human/product subject)
   • Data scenes (rm-d3-*)
   • Abstract / pattern scenes (anime-scatter with brand-tile lists)
   • List scenes (multiple co-equal items, no single hero subject)
   • Generic narrative ("we tested 5 tools" — no single subject to extract)

   mattingHint values:
   • "human"   — face / portrait / person (uses u2net_human_seg, the default)
   • "object"  — single non-human subject like a rocket, tool, animal, prop (uses u2net general)
   • "product" — clean industrial product shot (uses u2net general with tighter contour)

   Default mattingHint is "human" if you set needsMatting=true and aren't sure.

   IMPORTANT: needsMatting flags an INTENT. The pipeline will need a source image
   (in scene.assets or generated by 'pipeline images') before it can actually matte.
   So setting needsMatting=true on a scene without any source image is fine — it
   becomes a "you should provide a portrait here" hint to the user.

9.5. Also emit "imageStyle" (DRIVES THE LOOK OF THE GENERATED BACKGROUND IMAGE — important for not having every scene look like generic AI tech art):

   • cinematic       — wide hero shot, anamorphic, shallow DOF, rich color. Use for: opening hooks, climactic statements, anything that wants to feel "expensive".
   • editorial       — magazine-style still life, clean composition, lots of negative space. Use for: data narration scenes, product mentions, calm explanation.
   • abstract-pattern — non-photographic graphic shapes, brand-color heavy. Use for: list scenes (anime-scatter), section titles where text dominates.
   • product-hero    — single subject, soft shadow, studio lighting. Use for: a specific product/feature highlight (hf-tailwind-card).
   • minimal-dark    — near-black with one accent color, almost empty. Use for: scenes BEHIND data charts (rm-d3-*) so the chart shines.
   • portrait-moody  — close human face, warm-cool light. Use for: emotional/personal beats. AVOID unless explicitly narrating a person.
   • documentary     — candid, hand-held feel, environmental. Use for: real-world examples, scene-setting.
   • tech-3d         — CGI glass + neon edges. USE SPARINGLY. Easy to overdo — looks like stock AI art when on every scene.

   AIM FOR VARIETY across the 8-30 scenes. At least 3 distinct styles per video. Don't put "tech-3d" on every scene just because the topic is tech.

10. "reasoning" ≤ 50 Chinese chars per scene, single sentence, factual. Mention motion/focus/transition choice if it's non-default.
11. "assets": list filenames from the available assets pool that the scene should use, or [].
12. "notes": list of 0-3 short warnings/observations. Empty list if none.
13. OUTPUT VALID JSON ONLY. No prose, no markdown code fences. Structure:
{
  "scenes": [
    {
      "index": 1,
      "method": "hf-kinetic-text",
      "fallback": "hf-css-fade",
      "reasoning": "…",
      "assets": [],
      "notes": [],
      "motion": {"kind": "still"},
      "focus": null,
      "transition": "cut",
      "voice": null,
      "burnSubtitle": false
    },
    {
      "index": 5,
      "method": "hf-kinetic-text",
      "fallback": "hf-css-fade",
      "reasoning": "维度章节标题，从前面列表切过来。",
      "assets": [],
      "notes": [],
      "motion": {"kind": "still"},
      "focus": null,
      "transition": "fade",
      "transitionDur": 0.4,
      "voice": null,
      "burnSubtitle": false
    },
    {
      "index": 8,
      "method": "rm-d3-line-trend",
      "fallback": "hf-css-fade",
      "reasoning": "数据图，烧字幕作为补充上下文。",
      "assets": [],
      "notes": [],
      "motion": {"kind": "still"},
      "focus": {"kind": "vignette", "dim": 0.3},
      "transition": "fade",
      "burnSubtitle": true
    }
  ]
}`;
}

function buildUserPrompt(sb: Storyboard, assets: string[]): string {
  const totalSec = sb.scenes.at(-1)?.endSec ?? 0;
  const sceneLines = sb.scenes
    .map((s) => `  ${String(s.index).padStart(2, "0")}. [${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}s, ${s.durationSec.toFixed(1)}s]  ${JSON.stringify(s.text)}`)
    .join("\n");

  return `Project: ${sb.project.title}
Total duration: ${totalSec.toFixed(1)}s, ${sb.scenes.length} scenes
Frame: ${sb.project.width}×${sb.project.height} @ ${sb.project.fps}fps
Available assets (${assets.length}): ${assets.length ? assets.join(", ") : "(none — leave assets:[] for every scene)"}

SCENES:
${sceneLines}

Return JSON now.`;
}

/** Strip ```json … ``` fences if the model wraps its output in markdown. */
function unfence(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  // Sometimes models prepend a stray "JSON:" or "Response:" header.
  out = out.replace(/^(?:json|response|output)\s*:\s*/i, "");
  return out.trim();
}

/** Capture per-scene values before analyzer touches them, for the history diff. */
function snapshotScenes(sb: Storyboard): Record<number, Partial<Storyboard["scenes"][number]>> {
  const out: Record<number, any> = {};
  for (const s of sb.scenes) {
    out[s.index] = {
      method: s.method,
      fallback: s.fallback,
      reasoning: s.reasoning,
      assets: [...(s.assets ?? [])],
      notes: [...(s.notes ?? [])],
      motion: s.motion ? { ...s.motion } : null,
      focus: s.focus ? { ...s.focus } : null,
      transition: s.transition,
      transitionDur: s.transitionDur,
      voice: s.voice,
      burnSubtitle: s.burnSubtitle,
    };
  }
  return out;
}

function buildDiff(
  before: Record<number, Partial<Storyboard["scenes"][number]>>,
  after: Storyboard
): Record<number, Record<string, { from: unknown; to: unknown }>> {
  const result: Record<number, Record<string, { from: unknown; to: unknown }>> = {};
  for (const s of after.scenes) {
    const prev = before[s.index] ?? {};
    const fieldDiffs: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of ["method", "fallback", "reasoning", "voice", "burnSubtitle", "transition", "transitionDur", "motion", "focus", "assets", "notes"]) {
      const a = JSON.stringify((prev as any)[f] ?? null);
      const b = JSON.stringify((s as any)[f] ?? null);
      if (a !== b) fieldDiffs[f] = { from: (prev as any)[f] ?? null, to: (s as any)[f] ?? null };
    }
    if (Object.keys(fieldDiffs).length) result[s.index] = fieldDiffs;
  }
  return result;
}

export async function runAnalyze(opts: AnalyzeOpts): Promise<Storyboard> {
  const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
  const before = snapshotScenes(sb);
  const catalog = JSON.parse(fs.readFileSync(opts.catalogPath, "utf8")) as { methods: MethodDef[] };
  const designMd = fs.existsSync(opts.designPath)
    ? fs.readFileSync(opts.designPath, "utf8")
    : "(no design.md provided)";
  const assets = listAssets(opts.assetsDir);

  // Validate catalog lookup table
  const byId = new Map(catalog.methods.map((m) => [m.id, m]));
  const sMethods = new Set(catalog.methods.filter((m) => m.reliability === "S").map((m) => m.id));

  const system = buildSystemPrompt(catalog, designMd);
  const user = buildUserPrompt(sb, assets);

  const chatClient = getChat(opts.provider);
  console.log(`[analyze] provider=${chatClient.id}  scenes=${sb.scenes.length}  catalog=${catalog.methods.length}`);
  const reply = await chatClient.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 8192,
    temperature: 0.2,
  });

  let parsed: AnalyzerOutput;
  try {
    parsed = JSON.parse(unfence(reply));
  } catch (e) {
    throw new Error(
      `Analyzer returned invalid JSON. First 400 chars: ${reply.slice(0, 400)}…\n\nParse error: ${(e as Error).message}`
    );
  }
  if (!Array.isArray(parsed.scenes)) {
    throw new Error(`Analyzer JSON missing 'scenes' array: ${JSON.stringify(parsed).slice(0, 300)}`);
  }

  const pickByIdx = new Map<number, AnalyzerScenePick>();
  for (const p of parsed.scenes) pickByIdx.set(p.index, p);

  // Apply picks with validation
  const warnings: string[] = [];
  for (const sc of sb.scenes) {
    const pick = pickByIdx.get(sc.index);
    if (!pick) {
      warnings.push(`scene ${sc.index}: missing in analyzer output — left unchanged`);
      continue;
    }
    if (opts.fillOnly && sc.method) continue; // skip already-filled scenes

    if (!byId.has(pick.method)) {
      warnings.push(`scene ${sc.index}: unknown method '${pick.method}' — falling back to hf-css-fade`);
      pick.method = "hf-css-fade";
    }
    if (!sMethods.has(pick.fallback)) {
      warnings.push(`scene ${sc.index}: fallback '${pick.fallback}' is not reliability=S — using hf-css-fade`);
      pick.fallback = "hf-css-fade";
    }

    sc.method = pick.method;
    sc.fallback = pick.fallback;
    sc.reasoning = pick.reasoning?.trim() || null;
    sc.assets = Array.isArray(pick.assets) ? pick.assets : [];
    sc.notes = Array.isArray(pick.notes) ? pick.notes : [];
    // motion / focus — pass through with light validation
    if (pick.motion && pick.motion.kind) {
      const m = pick.motion;
      if (m.ease && /^linear|none$/i.test(m.ease)) {
        warnings.push(`scene ${sc.index}: motion.ease '${m.ease}' is linear — using power3.inOut`);
        m.ease = "power3.inOut";
      }
      sc.motion = {
        kind: m.kind,
        direction: m.direction,
        intensity: m.intensity ?? "subtle",
        ease: m.ease ?? "power3.inOut",
      };
    }
    if (pick.focus && pick.focus.kind) {
      sc.focus = {
        kind: pick.focus.kind,
        x: pick.focus.x ?? 0.5,
        y: pick.focus.y ?? 0.5,
        radius: pick.focus.radius ?? 0.4,
        dim: pick.focus.dim ?? (pick.focus.kind === "spotlight" ? 0.55 : 0.3),
      };
    }
    // Transition / voice / subtitle burn — pass through with light validation
    const validT = new Set(["cut", "fade", "dip-to-black", "wipe-left", "wipe-right", "push-up"]);
    sc.transition = pick.transition && validT.has(pick.transition) ? pick.transition : "cut";
    if (pick.transitionDur && pick.transitionDur > 0 && pick.transitionDur <= 2)
      sc.transitionDur = pick.transitionDur;
    if (pick.voice) sc.voice = pick.voice;
    sc.burnSubtitle = Boolean(pick.burnSubtitle);

    // imageStyle — drives the look of the AI-generated background.
    const validStyles = new Set(["cinematic", "editorial", "abstract-pattern", "product-hero", "minimal-dark", "portrait-moody", "documentary", "tech-3d"]);
    if (pick.imageStyle && validStyles.has(pick.imageStyle)) {
      sc.imageStyle = pick.imageStyle;
    } else {
      // Sensible default from method
      if (sc.method?.startsWith("rm-d3-")) sc.imageStyle = "minimal-dark";
      else if (sc.method === "hf-anime-scatter") sc.imageStyle = "abstract-pattern";
      else if (sc.method === "hf-tailwind-card") sc.imageStyle = "product-hero";
      else if (sc.method === "hf-kinetic-text") sc.imageStyle = "cinematic";
      else sc.imageStyle = "editorial";
    }
    // Matting intent — only set if the analyzer explicitly opted in.
    if (typeof pick.needsMatting === "boolean") {
      sc.needsMatting = pick.needsMatting;
      const validHints = new Set(["human", "object", "product"]);
      if (pick.mattingHint && validHints.has(pick.mattingHint)) {
        sc.mattingHint = pick.mattingHint;
      } else if (pick.needsMatting) {
        sc.mattingHint = "human"; // sensible default
      }
    }
  }

  sb.stages.analyzed = true;
  // analyze invalidates a prior approval — user must re-confirm picks.
  if (sb.stages.approved) sb.stages.approved = false;

  // Record the change in the history log.
  const diffs = buildDiff(before, sb);
  if (Object.keys(diffs).length) {
    const entry: ChangeEntry = {
      at: new Date().toISOString(),
      source: "analyzer",
      label: opts.fillOnly
        ? `analyzer fill-only on ${Object.keys(diffs).length} scene(s)`
        : `analyzer full re-pick on ${Object.keys(diffs).length} scene(s)`,
      diffs,
    };
    sb.history = [...(sb.history ?? []), entry];
  }

  fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));

  // Print compact summary
  const dist = new Map<string, number>();
  for (const sc of sb.scenes) dist.set(sc.method ?? "?", (dist.get(sc.method ?? "?") ?? 0) + 1);
  console.log(`\n✓ Analyzer filled ${sb.scenes.length} scenes. Method distribution:`);
  for (const [m, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    const meta = byId.get(m);
    const tier = meta?.reliability ?? "?";
    console.log(`    [${tier}]  ${m.padEnd(28)}  ${n}`);
  }
  if (warnings.length) {
    console.log(`\n⚠ ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`    · ${w}`);
  }
  return sb;
}
