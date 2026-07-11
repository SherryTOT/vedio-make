/**
 * Shared types for the video pipeline.
 *
 * Flow:
 *   subtitle.srt → cues[] → scenes[] (1+ cues each) → storyboard.json
 *   storyboard.json → per-scene MP4 → final stitched MP4
 */

// ───────────────────────────────────────────────────────────────────────────
// Input: subtitle cues
// ───────────────────────────────────────────────────────────────────────────

export interface Cue {
  /** Cue index (1-based, as in SRT) */
  index: number;
  /** Start time in seconds */
  startSec: number;
  /** End time in seconds */
  endSec: number;
  /** Caption text (may contain multiple lines joined by \n) */
  text: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Method registry
// ───────────────────────────────────────────────────────────────────────────

export type Engine = "hyperframes" | "remotion";

export type ReliabilityTier =
  | "S" // skill-backed by HyperFrames or Remotion; Claude has full docs
  | "A" // third-party skill installed; well-supported
  | "B"; // no skill; rely on Claude's training data — needs dry-run before render

export interface MethodDef {
  /** Unique method id, e.g. "hf-kinetic-text" or "rm-d3-bar-chart" */
  id: string;
  /** Human label, e.g. "GSAP Kinetic Text" */
  label: string;
  /** Which render engine owns this method */
  engine: Engine;
  /** Skill folder name in .agents/skills/, or null if no skill */
  skill: string | null;
  /** Library on npm (informational), e.g. "gsap", "d3" */
  library: string;
  /** Reliability tier (controls whether dry-run is needed) */
  reliability: ReliabilityTier;
  /** Categories — used by analyzer to match to content type */
  tags: string[];
  /** When the analyzer should pick this method */
  whenToUse: string;
  /** What inputs the method expects (informational for the analyzer) */
  inputs: string[];
  /** What asset types this method needs (e.g. ["image"], ["data:json"], []) */
  assetNeeds: string[];
  /** Suggested fallback method id (must be reliability=S) for when this one is risky */
  fallback?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Design system (multi-style presets, selectable + per-scene overridable)
// ───────────────────────────────────────────────────────────────────────────

export interface DesignMotion {
  ease: string;                                  // GSAP ease, e.g. "power3.out"
  tempo: "deliberate" | "snappy" | "gentle";
  enter: "rise" | "settle";
}

export interface DesignTokens {
  paper: string; pw: string;
  ink: string; ink2: string; muted: string;
  accent: string; accent2: string;
  /** Status colours for data emphasis (up/positive vs down/negative). Restrained,
   *  on-brand — NOT neon dashboard green/red. Used by mega-counter's delta arrow
   *  and any 数据强调 that needs a good/bad distinction (MOTION.md §三/§四). */
  ok: string; alert: string;
  line: string;
  serif: string; sans: string;
  display: "serif" | "sans";
  displayWeight: number;
  numberFamily: "serif" | "sans";
  chartPalette: string[];
  motion?: DesignMotion;        // optional on overrides; presets always set it
}

/** Storyboard/scene-level selection: a preset id plus optional token overrides. */
export interface DesignSelection {
  presetId: string;
  overrides?: Partial<DesignTokens>;
}

/** Fully-resolved tokens a renderer reads. Always has motion + the preset id. */
export type ResolvedDesign = DesignTokens & {
  motion: DesignMotion;
  __presetId: string;
};

// ───────────────────────────────────────────────────────────────────────────
// Scene (one or more contiguous cues, mapped to a method)
// ───────────────────────────────────────────────────────────────────────────

export interface Scene {
  /** Scene index (1-based) */
  index: number;
  /** Cues included in this scene (1+, contiguous in time) */
  cues: Cue[];
  /** Aggregate start (= first cue start) */
  startSec: number;
  /** Aggregate end (= last cue end) */
  endSec: number;
  /** Duration in seconds */
  durationSec: number;
  /** Full caption text (newline-joined across cues) */
  text: string;

  /** Primary method id chosen by Claude (null until analyzer fills it) */
  method: string | null;
  /** Backup method id (must reference a reliability=S method) */
  fallback: string | null;
  /** Claude's rationale for picking these methods */
  reasoning: string | null;

  /** Assets referenced from project's assets/ folder */
  assets: string[];

  /** Notes/risks Claude wants the user to see in the storyboard */
  notes: string[];

  /** Real chart data, filled by `pipeline research`. Renderer-specific shape. */
  data?: {
    items?: { label: string; value: number }[];           // rm-d3-bar-chart
    years?: string[];                                     // rm-d3-line-trend
    series?: { name: string; color?: string; values: number[] }[];
    columns?: string[];                                   // rm-framer-table
    rows?: string[][];
  };
  /** Web search query used to populate `data` */
  researchQuery?: string;
  /** URLs the data came from */
  researchSources?: { title: string; url: string }[];

  // ─── Effect modifiers (filled by analyzer, applied by renderer) ─────────
  /**
   * Camera motion for image-backed scenes (Ken Burns, dolly, pan). Non-linear
   * ease curve recommended — gives a "expensive" feel vs the cheap CSS linear.
   */
  motion?: {
    kind: "kenburns" | "dolly" | "pan" | "still";
    direction?: "in" | "out" | "left" | "right" | "up" | "down";
    /** Visual intensity. subtle=1.06 medium=1.14 strong=1.22. */
    intensity?: "subtle" | "medium" | "strong";
    /** GSAP ease string. Default: "power3.inOut" for smooth non-linear. */
    ease?: string;
  };
  /**
   * Focus / vignette effect drawn on top of the scene to direct the eye.
   * x/y/radius are normalized 0..1 (so resolution-agnostic).
   */
  focus?: {
    kind: "vignette" | "spotlight" | "dof";
    /** Focal point center. Default 0.5/0.5 */
    x?: number;
    y?: number;
    /** Inner-bright radius (spotlight) / vignette inner edge */
    radius?: number;
    /** Outside dim opacity 0..1. Default: 0.35 for vignette, 0.55 for spotlight */
    dim?: number;
  };
  /**
   * Path (relative to assets/) of a matted PNG (transparent background) to
   * composite over the scene background. Produced by `pipeline matte`.
   */
  foreground?: string;
  /**
   * Analyzer flag: this scene's narrative benefits from a SUBJECT cut out
   * of its background and composited as a separate foreground layer.
   *
   * True when:
   *   - Scene emphasizes one person, product, or single object ("Look at this thing")
   *   - Scene wants foreground/background parallax for depth
   *   - The cue text references a single subject (a person name, a product)
   *
   * False (default) when:
   *   - Pure text scenes (no subject visible)
   *   - Charts/data scenes
   *   - Abstract-pattern scenes
   *   - List scenes
   *
   * `pipeline matte --auto` reads this flag and processes flagged scenes.
   */
  needsMatting?: boolean;
  /**
   * Analyzer hint: what KIND of subject to expect when matting.
   *   "human"   — u2net_human_seg model (default rembg / hyperframes)
   *   "object"  — u2net general (better for non-human subjects)
   *   "product" — same as object but tighter contour
   * Drives which matting model the pipeline picks.
   */
  mattingHint?: "human" | "object" | "product";
  /**
   * Transition INTO this scene from the previous scene.
   *   "cut"         — hard cut, no fade (default)
   *   "fade"        — crossfade with previous scene
   *   "dip-to-black" — fade-out-to-black then fade-in
   *   "wipe-left" / "wipe-right" — directional wipe
   *   "push-up"     — push transition
   * Stitcher uses ffmpeg xfade filter chain.
   */
  transition?: "cut" | "fade" | "dip-to-black" | "wipe-left" | "wipe-right" | "push-up";
  /** Duration of the transition in seconds. Default 0.4 for fade/wipe, 0.6 for dip. */
  transitionDur?: number;
  /** Optional TTS voice id override for this scene. Falls back to global default. */
  voice?: string;
  /** Burn the cue text on top of the final video as a subtitle band. */
  burnSubtitle?: boolean;
  /**
   * Visual style hint for the image generator. Drives prompt construction —
   * each style maps to a distinct lens/color/composition recipe, so the same
   * scene catalog produces visually-distinct outputs instead of "generic AI art".
   *
   *   cinematic       — anamorphic, shallow DOF, rich color, hero shots
   *   editorial       — magazine-style still, clean negative space, photo realism
   *   abstract-pattern — non-photographic, graphic shapes, brand-color heavy
   *   product-hero    — single subject, soft shadow, studio lighting
   *   minimal-dark    — near-black, single accent color, minimal subject (for chart underlays)
   *   portrait-moody  — close human face, warm-cool lighting, narrative tone
   *   documentary     — candid, hand-held feel, environmental
   *   tech-3d         — cgi glass + neon edges (use sparingly — easy to overdo)
   */
  imageStyle?:
    | "cinematic"
    | "editorial"
    | "abstract-pattern"
    | "product-hero"
    | "minimal-dark"
    | "portrait-moody"
    | "documentary"
    | "tech-3d";

  /** Per-scene style override. Wins over project.design.
   *  presetId omitted = inherit project preset, only override tokens. */
  style?: { presetId?: string; overrides?: Partial<DesignTokens> };

  /** Filled after render — relative path to the scene MP4 (e.g. "output/scenes/scene-001.mp4") */
  renderedPath?: string;
  /** Source-code hash at time of render — bumps when method / scene text changes,
   *  forces re-render even if the mp4 file already exists. */
  renderedHash?: string;
  /** Render status */
  status?: "pending" | "rendering" | "rendered" | "failed";
}

// ───────────────────────────────────────────────────────────────────────────
// Storyboard (the persistent contract between agent + user + renderer)
// ───────────────────────────────────────────────────────────────────────────

/** A single change made to the storyboard, kept in storyboard.history[]. */
export interface ChangeEntry {
  /** ISO timestamp */
  at: string;
  /** Who made the change */
  source: "analyzer" | "user-nl" | "user-inline" | "user-manual";
  /** Free-text label (e.g. the analyzer's request, the user's instruction) */
  label: string;
  /** Per-scene field-level diffs: scene index → { field: { from, to } } */
  diffs: Record<number, Record<string, { from: unknown; to: unknown }>>;
}

export interface Storyboard {
  /** Source SRT file path (relative to project root) */
  source: string;
  /** Project meta */
  project: {
    title: string;
    width: number;
    height: number;
    fps: number;
    /** Path to design.md (relative) */
    designDoc: string;
    /** Selected visual style preset + optional token overrides. Absent ⇒ inkwork. */
    design?: DesignSelection;
  };
  /** Available assets in assets/ folder at plan time */
  assetPool: string[];
  /** Scenes in order */
  scenes: Scene[];
  /** Timestamp the planner generated this storyboard */
  createdAt: string;
  /** Stages the storyboard has gone through */
  stages: {
    parsed: boolean;
    analyzed: boolean;
    approved: boolean;
    rendered: boolean;
  };
  /** Append-only audit log of every change (analyzer + user). Newest last. */
  history?: ChangeEntry[];
}
