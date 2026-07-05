/**
 * `pipeline edit "<natural language instruction>"` — apply user edits to the
 * storyboard via Minimax chat. The model receives the current storyboard +
 * method catalog + instruction, and returns a JSON patch that we apply
 * field-by-field, with an audit-log entry written to storyboard.history.
 *
 * Examples:
 *   pipeline edit "scene 5 换成 D3 柱状图"
 *   pipeline edit "整片所有 hero scene 都改 presenter_female 女声"
 *   pipeline edit "scene 12 加 burn subtitle"
 *   pipeline edit "把开场 scene 1 改成 kenburns slow zoom-in"
 *   pipeline edit "scene 8 transition fade → dip-to-black"
 *
 * Safety: the model is asked to return MINIMAL changes (only fields that
 * actually change) so the diff stays auditable. Unknown method ids fall
 * back to the existing scene method. The diff is shown to the user before
 * being written.
 */

import fs from "node:fs";
import path from "node:path";
import { getChat } from "./providers/registry.ts";
import type { ChangeEntry, MethodDef, Scene, Storyboard } from "./types.ts";

interface EditOpts {
  instruction: string;
  storyboardPath: string;
  catalogPath: string;
  provider?: string;
  /** Don't actually apply — just print the proposed diff. */
  dryRun?: boolean;
  /** Don't prompt — apply immediately. */
  yes?: boolean;
}

interface ModelPatch {
  /** Scenes to modify. Only include scenes that actually change. */
  scenes: Array<{
    index: number;
    /** Any of these fields may be present. Others are unchanged. */
    method?: string;
    fallback?: string;
    reasoning?: string;
    voice?: string | null;
    burnSubtitle?: boolean;
    transition?: Scene["transition"];
    transitionDur?: number;
    motion?: Scene["motion"];
    focus?: Scene["focus"] | null;
    assets?: string[];
    notes?: string[];
    imageStyle?: Scene["imageStyle"];
    needsMatting?: boolean;
    mattingHint?: Scene["mattingHint"];
  }>;
  /** Optional explanation of WHAT this edit changed (for the audit log) */
  summary?: string;
}

const PATCHABLE_FIELDS: (keyof Scene)[] = [
  "method", "fallback", "reasoning", "voice", "burnSubtitle",
  "transition", "transitionDur", "motion", "focus", "assets", "notes",
  "imageStyle", "needsMatting", "mattingHint",
];

// Field whitelists for nested objects. Strip anything not in these lists,
// because models sometimes invent fields (e.g. focus.intensity instead of
// focus.radius) which would silently corrupt the scene.
const MOTION_FIELDS = new Set(["kind", "direction", "intensity", "ease"]);
const MOTION_KINDS = new Set(["kenburns", "dolly", "pan", "still"]);
const FOCUS_FIELDS = new Set(["kind", "x", "y", "radius", "dim"]);
const FOCUS_KINDS = new Set(["vignette", "spotlight", "dof"]);

function sanitizeMotion(m: any, warnings: string[], sceneIdx: number): any {
  if (m == null) return m;
  if (typeof m !== "object") return null;
  const out: any = {};
  for (const [k, v] of Object.entries(m)) {
    if (!MOTION_FIELDS.has(k)) {
      warnings.push(`scene ${sceneIdx}: motion.${k} is not a valid field — dropped`);
      continue;
    }
    if (k === "kind" && !MOTION_KINDS.has(String(v))) {
      warnings.push(`scene ${sceneIdx}: motion.kind '${v}' is invalid — using 'still'`);
      out.kind = "still";
    } else {
      out[k] = v;
    }
  }
  if (!out.kind) out.kind = "still";
  return out;
}

function sanitizeFocus(f: any, warnings: string[], sceneIdx: number): any {
  if (f === null) return null;
  if (typeof f !== "object") return null;
  const out: any = {};
  for (const [k, v] of Object.entries(f)) {
    if (!FOCUS_FIELDS.has(k)) {
      // Common mistake: model says "intensity:0.3" meaning "dim:0.3" or "radius:0.3".
      // Don't auto-translate (ambiguous) — just warn + drop.
      warnings.push(
        `scene ${sceneIdx}: focus.${k} is not a valid field — dropped (valid: ${[...FOCUS_FIELDS].join(", ")})`
      );
      continue;
    }
    if (k === "kind" && !FOCUS_KINDS.has(String(v))) {
      warnings.push(`scene ${sceneIdx}: focus.kind '${v}' is invalid — clearing focus`);
      return null;
    }
    out[k] = v;
  }
  if (!out.kind) return null;
  // Ensure required defaults
  if (out.dim == null) out.dim = out.kind === "spotlight" ? 0.55 : 0.3;
  if (out.x == null) out.x = 0.5;
  if (out.y == null) out.y = 0.5;
  if (out.radius == null) out.radius = 0.4;
  return out;
}

function buildSystemPrompt(catalog: { methods: MethodDef[] }): string {
  const methodIds = catalog.methods.map((m) => `${m.id} (${m.reliability})`).join(", ");
  return `You are the EDITOR step of a video pipeline. The user gives a natural-language instruction; you produce a minimal JSON patch to apply to the storyboard.

═══════════════════════════════════════════════════════════════════
RULES (strict)
═══════════════════════════════════════════════════════════════════
1. Output VALID JSON ONLY, no prose, no markdown fences.
2. Schema:
   {
     "scenes": [
       {"index": <1-based int>, "<field>": <new value>, ...},
       ...
     ],
     "summary": "<one-sentence Chinese description of the change>"
   }
3. Only include scenes that change. Only include fields that change.
4. PATCHABLE fields: method, fallback, reasoning, voice, burnSubtitle,
   transition, transitionDur, motion, focus, assets, notes,
   imageStyle, needsMatting, mattingHint.
   • imageStyle ∈ cinematic|editorial|abstract-pattern|product-hero|minimal-dark|portrait-moody|documentary|tech-3d
   • needsMatting is a boolean. mattingHint ∈ human|object|product.
   Do NOT change: index, cues, startSec, endSec, durationSec, text.
5. "method" must be one of these ids: ${methodIds}.
6. "fallback" must be a reliability=S method.
7. "transition" ∈ "cut" | "fade" | "dip-to-black" | "wipe-left" | "wipe-right" | "push-up".
8. "voice" may be a Minimax voice id, or null to revert to project default.
9. "motion" full object: {kind, direction?, intensity?, ease?}. "focus" full object
   or null to clear.
10. If the instruction is ambiguous, pick the most likely interpretation and
    explain in "summary". Don't ask follow-up questions — we're stateless.
11. If the instruction targets "all scenes" / "every hero scene" / etc.,
    expand it into individual scene entries.
12. NEVER touch a scene the user didn't address.`;
}

function buildUserPrompt(sb: Storyboard, instruction: string): string {
  // Compact one-line-per-scene digest of the current storyboard.
  const lines = sb.scenes.map((s) => {
    const m = (s.motion?.kind ?? "still");
    const f = (s.focus?.kind ?? "—");
    return `  ${String(s.index).padStart(2, "0")}. [${s.durationSec.toFixed(1)}s] ${JSON.stringify(s.text.slice(0, 38))}  method=${s.method ?? "?"}  voice=${s.voice ?? "default"}  motion=${m}  focus=${f}  trans=${s.transition ?? "cut"}  burn=${s.burnSubtitle ?? false}`;
  });
  return `CURRENT STORYBOARD (${sb.scenes.length} scenes):

${lines.join("\n")}

USER INSTRUCTION:
"""
${instruction}
"""

Return the JSON patch now.`;
}

function unfence(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) out = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  return out.replace(/^(?:json|response|patch|output)\s*:\s*/i, "").trim();
}

/** Apply a single scene patch and return the per-field diff. */
function applySceneEdit(
  scene: Scene,
  edit: ModelPatch["scenes"][number],
  catalog: { methods: MethodDef[] },
  warnings: string[]
): Record<string, { from: unknown; to: unknown }> {
  const diffs: Record<string, { from: unknown; to: unknown }> = {};
  const validIds = new Set(catalog.methods.map((m) => m.id));
  const sIds = new Set(catalog.methods.filter((m) => m.reliability === "S").map((m) => m.id));
  for (const f of PATCHABLE_FIELDS) {
    if (!(f in edit)) continue;
    let next = (edit as any)[f];
    const prev = (scene as any)[f];
    // Validate per-field
    if (f === "method" && typeof next === "string" && !validIds.has(next)) {
      warnings.push(`scene ${scene.index}: unknown method '${next}' — kept original '${prev ?? "?"}'`);
      continue;
    }
    if (f === "fallback" && typeof next === "string" && !sIds.has(next)) {
      warnings.push(`scene ${scene.index}: fallback '${next}' is not reliability=S — using hf-css-fade`);
      next = "hf-css-fade";
    }
    if (f === "transition" && typeof next === "string" && !["cut", "fade", "dip-to-black", "wipe-left", "wipe-right", "push-up"].includes(next)) {
      warnings.push(`scene ${scene.index}: unknown transition '${next}' — kept original`);
      continue;
    }
    if (f === "voice" && next === "") {
      next = null;
    }
    // Nested-object sanitizers — strip invented fields models might emit
    if (f === "motion") next = sanitizeMotion(next, warnings, scene.index);
    if (f === "focus")  next = sanitizeFocus(next, warnings, scene.index);

    // Apply if the deep-equal compare says they differ
    const before = JSON.stringify(prev ?? null);
    const after = JSON.stringify(next ?? null);
    if (before !== after) {
      diffs[f] = { from: prev ?? null, to: next ?? null };
      (scene as any)[f] = next;
    }
  }
  // Bump renderedHash invalidation by clearing it — forces re-render of edited scenes.
  if (Object.keys(diffs).length && scene.renderedHash) {
    diffs["renderedHash"] = { from: scene.renderedHash, to: null };
    delete scene.renderedHash;
  }
  return diffs;
}

function printDiffs(allDiffs: Record<number, Record<string, { from: unknown; to: unknown }>>, sb: Storyboard): void {
  const entries = Object.entries(allDiffs);
  if (!entries.length) {
    console.log("\n(no changes — the instruction didn't match anything)");
    return;
  }
  console.log(`\nProposed changes to ${entries.length} scene(s):\n`);
  for (const [idx, d] of entries) {
    const sc = sb.scenes.find((s) => s.index === +idx);
    const text = sc?.text.slice(0, 36) ?? "?";
    console.log(`  scene ${idx.padStart(2, "0")}  «${text}»`);
    for (const [field, change] of Object.entries(d)) {
      if (field === "renderedHash") continue;
      const f = (s: unknown) => (typeof s === "string" ? `"${s}"` : JSON.stringify(s));
      console.log(`     · ${field.padEnd(12)} ${f(change.from)} → ${f(change.to)}`);
    }
  }
}

export async function runEdit(opts: EditOpts): Promise<void> {
  const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
  const catalog = JSON.parse(fs.readFileSync(opts.catalogPath, "utf8")) as { methods: MethodDef[] };

  const chat = getChat(opts.provider);
  console.log(`[edit] provider=${chat.id}  instruction: "${opts.instruction}"\n`);

  const reply = await chat.chat({
    messages: [
      { role: "system", content: buildSystemPrompt(catalog) },
      { role: "user", content: buildUserPrompt(sb, opts.instruction) },
    ],
    maxTokens: 4096,
    temperature: 0.2,
  });

  let patch: ModelPatch;
  try {
    patch = JSON.parse(unfence(reply));
  } catch (e) {
    throw new Error(`edit: model returned invalid JSON. First 400 chars: ${reply.slice(0, 400)}…`);
  }
  if (!Array.isArray(patch.scenes)) {
    throw new Error(`edit: response missing 'scenes' array: ${JSON.stringify(patch).slice(0, 300)}`);
  }

  const warnings: string[] = [];
  const allDiffs: Record<number, Record<string, { from: unknown; to: unknown }>> = {};
  // Apply tentatively — show diff before committing
  const sbCopy: Storyboard = JSON.parse(JSON.stringify(sb));
  for (const sceneEdit of patch.scenes) {
    const sc = sbCopy.scenes.find((s) => s.index === sceneEdit.index);
    if (!sc) {
      warnings.push(`scene ${sceneEdit.index}: not in storyboard — ignored`);
      continue;
    }
    const d = applySceneEdit(sc, sceneEdit, catalog, warnings);
    if (Object.keys(d).length) allDiffs[sceneEdit.index] = d;
  }

  printDiffs(allDiffs, sbCopy);
  if (patch.summary) console.log(`\nsummary: ${patch.summary}`);
  if (warnings.length) {
    console.log(`\n⚠ ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`   · ${w}`);
  }

  if (opts.dryRun) {
    console.log("\n(dry run — no changes written)");
    return;
  }
  if (!Object.keys(allDiffs).length) return;

  // Confirmation
  if (!opts.yes) {
    const ok = await confirmPrompt(`\nApply ${Object.keys(allDiffs).length} scene change(s)? [Y/n] `);
    if (!ok) {
      console.log("(cancelled)");
      return;
    }
  }

  // Commit — copy diffs back to live sb, write history entry
  for (const sceneEdit of patch.scenes) {
    const sc = sb.scenes.find((s) => s.index === sceneEdit.index);
    if (!sc) continue;
    applySceneEdit(sc, sceneEdit, catalog, []);  // re-apply for real
  }
  const entry: ChangeEntry = {
    at: new Date().toISOString(),
    source: "user-nl",
    label: opts.instruction,
    diffs: allDiffs,
  };
  sb.history = [...(sb.history ?? []), entry];
  // Re-edit invalidates "approved" gate
  sb.stages.approved = false;
  fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));
  console.log(`\n✓ Applied. Re-run 'pipeline storyboard' to refresh preview, then re-render.`);
}

async function confirmPrompt(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true; // non-interactive — auto-yes
  process.stdout.write(question);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => {
      // Pause the stream so its open handle stops keeping the event loop alive —
      // otherwise the CLI hangs forever after the user answers.
      process.stdin.pause();
      const s = String(d).trim().toLowerCase();
      resolve(s === "" || s === "y" || s === "yes" || s === "是");
    });
  });
}
