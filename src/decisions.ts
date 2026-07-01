/**
 * Decision log — an append-only, auditable record of the meaningful choices the
 * pipeline makes (provider fallbacks, render-engine picks, cost snapshots), so
 * "why did it use Edge instead of MiniMax?" has an answer instead of a shrug.
 *
 * Written to output/decisions.json. Deliberately lightweight: never throws,
 * capped, no schema ceremony. Read it back via readDecisions() or GET
 * /api/projects/:id/decisions.
 */
import fs from "node:fs";
import path from "node:path";

export interface Decision {
  /** ISO timestamp. */
  at: string;
  /** Which pipeline stage made the call, e.g. "tts" | "render" | "estimate". */
  stage: string;
  /** Kind of decision, e.g. "provider-fallback" | "engine" | "cost". */
  category: string;
  /** What the decision is about, e.g. "场景 #3 配音". */
  subject: string;
  /** What was chosen. */
  selected: string;
  /** Human reason. */
  reason: string;
  /** Alternatives considered (optional). */
  options?: string[];
  confidence?: "high" | "medium" | "low";
}

const CAP = 500;

export function logDecision(outputDir: string, d: Omit<Decision, "at"> & { at?: string }): void {
  try {
    const file = path.join(outputDir, "decisions.json");
    let log: Decision[] = [];
    if (fs.existsSync(file)) {
      try { log = JSON.parse(fs.readFileSync(file, "utf8")); } catch { log = []; }
      if (!Array.isArray(log)) log = [];
    }
    log.push({ at: d.at ?? new Date().toISOString(), ...d });
    if (log.length > CAP) log.splice(0, log.length - CAP);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
  } catch {
    /* logging must never break the pipeline */
  }
}

export function readDecisions(outputDir: string): Decision[] {
  try {
    const file = path.join(outputDir, "decisions.json");
    if (!fs.existsSync(file)) return [];
    const log = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(log) ? log : [];
  } catch {
    return [];
  }
}
