/**
 * `pipeline render <storyboard.json>` — for each scene:
 *   1. Look up its method in METHOD_RENDERERS.
 *   2. Generate the scene source (HyperFrames HTML or Remotion TSX) into output/scenes/<id>/.
 *   3. Invoke the matching renderer subprocess.
 *   4. Move the produced MP4 to output/scenes/scene-<NNN>.mp4 and update storyboard.
 *
 * After all scenes render, stitch them via ffmpeg concat into output/final.mp4.
 * Stitching uses the storyboard scene order — gaps between scenes (if any)
 * are NOT filled (caller's responsibility to make scene timing contiguous).
 *
 * Re-running render only re-renders scenes whose source has changed (hash check),
 * unless --force is passed.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { METHOD_RENDERERS } from "./methods/registry.ts";
import type { MethodRenderer, RenderContext } from "./methods/registry.ts";
import type { Scene, Storyboard } from "./types.ts";
import { hardenHyperFrames } from "./harden.ts";

interface RenderOpts {
  storyboardPath: string;
  outputDir: string;
  projectRoot: string;
  force: boolean;
  /** Only render this scene index (1-based), or null for all */
  only: number | null;
  /** Max concurrent scene renders. Default 1 (sequential). 2-3 recommended. */
  workers?: number;
}

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

function run(cmd: string, args: string[], cwd: string): void {
  console.log(`[run] ${cmd} ${args.join(" ")}  (cwd=${path.relative(process.cwd(), cwd) || "."})`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")} (exit ${r.status})`);
  }
}

function renderHyperFramesScene(
  sceneDir: string,
  html: string,
  sideFiles: Record<string, string> | undefined,
  outMp4: string
): void {
  // Portability/determinism pass: bundle CJK fonts + vendor CDN libs so the
  // scene renders identically on Docker/Linux/CI/offline (not just this Mac).
  const hardened = hardenHyperFrames(html, sideFiles);
  html = hardened.html;
  sideFiles = hardened.sideFiles;

  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, "index.html"), html);
  fs.writeFileSync(
    path.join(sceneDir, "package.json"),
    JSON.stringify(
      {
        name: path.basename(sceneDir),
        private: true,
        type: "module",
      },
      null,
      2
    )
  );
  // Copy side files (assets, layer pngs, etc.) preserving relative structure
  if (sideFiles) {
    for (const [rel, src] of Object.entries(sideFiles)) {
      const dst = path.join(sceneDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  // Render. Pinned to 0.6.7 (NOT 0.5.7): 0.5.x does not embed fonts referenced
  // via @font-face url() in injected CSS, so hardenHyperFrames' bundled CJK
  // fonts 404 and Chinese silently falls back to a system font (tofu off-Mac).
  // 0.6.x embeds them per the documented fonts/ + @font-face mechanism.
  run("npx", ["--yes", "hyperframes@0.6.7", "render", "--output", path.resolve(outMp4)], sceneDir);
}

function renderRemotionScene(
  sceneDir: string,
  tsx: string,
  compId: string,
  props: Record<string, unknown>,
  width: number,
  height: number,
  fps: number,
  durationSec: number,
  outMp4: string,
  sideFiles?: Record<string, string>
): void {
  fs.mkdirSync(path.join(sceneDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(sceneDir, "public"), { recursive: true });
  // Copy side files (image / video / lottie assets that Remotion's staticFile() will look up).
  if (sideFiles) {
    for (const [rel, src] of Object.entries(sideFiles)) {
      const dst = path.join(sceneDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  const durationInFrames = Math.max(1, Math.round(durationSec * fps));

  fs.writeFileSync(path.join(sceneDir, "src", "Composition.tsx"), tsx);
  fs.writeFileSync(
    path.join(sceneDir, "src", "Root.tsx"),
    `import React from "react";
import { Composition } from "remotion";
import { Scene } from "./Composition";

const defaultProps = ${JSON.stringify(props)};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="${compId}"
    component={Scene as any}
    durationInFrames={${durationInFrames}}
    fps={${fps}}
    width={${width}}
    height={${height}}
    defaultProps={defaultProps as any}
  />
);
`
  );
  fs.writeFileSync(
    path.join(sceneDir, "src", "index.ts"),
    `import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";
registerRoot(RemotionRoot);
`
  );
  fs.writeFileSync(
    path.join(sceneDir, "remotion.config.ts"),
    `import { Config } from "@remotion/cli/config";
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
`
  );
  fs.writeFileSync(
    path.join(sceneDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2018",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          isolatedModules: true,
          lib: ["DOM", "ES2020"],
        },
        include: ["src/**/*"],
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(sceneDir, "package.json"),
    JSON.stringify(
      {
        name: path.basename(sceneDir),
        private: true,
        version: "0.0.0",
        dependencies: {
          "@remotion/bundler": "^4.0.220",
          "@remotion/cli": "^4.0.220",
          "@remotion/renderer": "^4.0.220",
          "react": "^18.3.1",
          "react-dom": "^18.3.1",
          "remotion": "^4.0.220",
          "d3": "^7.9.0",
        },
        devDependencies: {
          "@types/d3": "^7.4.3",
          "@types/react": "^18.3.3",
          typescript: "^5.4.5",
        },
      },
      null,
      2
    )
  );

  // Install + render
  run("npm", ["install", "--silent", "--no-audit", "--no-fund"], sceneDir);
  run(
    "npx",
    [
      "--yes",
      "remotion",
      "render",
      "src/index.ts",
      compId,
      path.resolve(outMp4),
      `--props=${JSON.stringify(props)}`,
      "--concurrency=4",
    ],
    sceneDir
  );
}

interface SceneClip {
  path: string;
  durationSec: number;
  /** Transition INTO this clip from the previous one ("cut" for first scene). */
  transition: "cut" | "fade" | "dip-to-black" | "wipe-left" | "wipe-right" | "push-up";
  transitionDur: number;
}

function stitchScenes(scenePaths: string[], outFinal: string): void {
  if (scenePaths.length === 0) return;
  // Concat demuxer with -c copy is the fastest path for hard-cut stitching.
  const listPath = path.join(path.dirname(outFinal), "concat.txt");
  const list = scenePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, list);
  run(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outFinal],
    path.dirname(outFinal)
  );
}

/**
 * Stitch using ffmpeg xfade filter when any scene has a non-"cut" transition.
 * xfade requires consistent encoding (libx264 reencode here, slower than concat
 * but supports crossfade/wipe/dip-to-black). We only fall into this path when
 * needed; otherwise stitchScenes() is faster.
 */
function stitchScenesWithTransitions(clips: SceneClip[], outFinal: string): void {
  if (clips.length === 0) return;
  if (clips.length === 1) {
    fs.copyFileSync(clips[0].path, outFinal);
    return;
  }

  // Map our transition name → xfade transition type.
  const xfadeTypes: Record<string, string> = {
    "fade":         "fade",
    "dip-to-black": "fadeblack",
    "wipe-left":    "wipeleft",
    "wipe-right":   "wiperight",
    "push-up":      "slideup",
  };

  // Build a filter graph that xfades clip i+1 onto the running mix.
  // For N clips, we have N-1 xfade nodes chained. Each xfade has:
  //   offset = (running_duration - transition_duration_for_this_step)
  // Cut transitions use a 0-duration xfade trick: we set duration=0.04 (minimum)
  // with fade type — visually indistinguishable from a cut but lets us keep the
  // chain shape consistent. (Pure concat is the alternative when ALL are cuts.)
  const inputs: string[] = [];
  for (const c of clips) inputs.push("-i", c.path);

  let prevLabel = "[0:v]";
  const filterSteps: string[] = [];
  let runningDur = clips[0].durationSec;
  for (let i = 1; i < clips.length; i++) {
    const c = clips[i];
    const isCut = c.transition === "cut";
    const xfade = xfadeTypes[c.transition] ?? "fade";
    const tDur = isCut ? 0.04 : Math.min(c.transitionDur, c.durationSec * 0.4, clips[i - 1].durationSec * 0.4);
    const offset = (runningDur - tDur).toFixed(3);
    const outLabel = i === clips.length - 1 ? "[vout]" : `[v${i}]`;
    filterSteps.push(
      `${prevLabel}[${i}:v]xfade=transition=${xfade}:duration=${tDur.toFixed(3)}:offset=${offset}${outLabel}`
    );
    prevLabel = outLabel;
    runningDur = runningDur + c.durationSec - tDur;
  }

  const filterStr = filterSteps.join(";");
  run(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      ...inputs,
      "-filter_complex",
      filterStr,
      "-map",
      "[vout]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      outFinal,
    ],
    path.dirname(outFinal)
  );
}

/**
 * Burn the input SRT subtitle file onto the video via ffmpeg `subtitles` filter.
 * Run AFTER audio mix as a final pass — produces a *.burned.mp4 alongside.
 */
/** Check which subtitle-burn-capable filters this ffmpeg build supports. */
function ffmpegFilterCapabilities(): { hasSubtitles: boolean; hasDrawtext: boolean } {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
  if (r.status !== 0) return { hasSubtitles: false, hasDrawtext: false };
  const out = r.stdout || "";
  return {
    hasSubtitles: /^\s*\S+\s+subtitles\b/m.test(out),
    hasDrawtext: /^\s*\S+\s+drawtext\b/m.test(out),
  };
}

function ffmpegHasSubtitlesFilter(): boolean {
  return ffmpegFilterCapabilities().hasSubtitles;
}

/** Parse our generated SRT into cue objects for the drawtext fallback. */
function parseSrtForBurn(srtPath: string): Array<{ start: number; end: number; text: string }> {
  const src = fs.readFileSync(srtPath, "utf8").replace(/\r\n?/g, "\n");
  const cues: Array<{ start: number; end: number; text: string }> = [];
  const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
  for (const block of src.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const ti = lines.findIndex((l) => TIME.test(l));
    if (ti < 0) continue;
    const m = lines[ti].match(TIME)!;
    const toSec = (h: string, mn: string, s: string, ms: string) =>
      +h * 3600 + +mn * 60 + +s + +ms.padEnd(3, "0").slice(0, 3) / 1000;
    cues.push({
      start: toSec(m[1], m[2], m[3], m[4]),
      end: toSec(m[5], m[6], m[7], m[8]),
      text: lines.slice(ti + 1).join(" ").replace(/[\\:'%]/g, "\\$&"),
    });
  }
  return cues;
}

/**
 * Burn subtitles onto a video.
 *
 *   Path A (preferred): ffmpeg subtitles=... filter (libass).
 *   Path B (fallback):  drawtext per-cue with enable='between(t,start,end)'.
 *                       Triggered when local ffmpeg was built without --enable-libass
 *                       (Homebrew default). Uses /System/Library/Fonts/PingFang.ttc.
 */
/**
 * Platform-aware CJK font for subtitle burn.
 *   - name: family name libass resolves via fontconfig (Path A).
 *   - file: an existing on-disk font for the drawtext fallback (Path B).
 * Windows/Linux paths added so burn works off macOS.
 */
function cjkBurnFont(): { name: string; file: string | null } {
  const plat = process.platform;
  let name: string;
  let candidates: string[];
  if (plat === "win32") {
    name = "Microsoft YaHei";
    candidates = [
      "C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc",
      "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc",
    ];
  } else if (plat === "darwin") {
    name = "PingFang SC";
    candidates = [
      "/System/Library/Fonts/PingFang.ttc",
      "/System/Library/Fonts/Helvetica.ttc",
      "/Library/Fonts/Arial Unicode.ttf",
    ];
  } else {
    name = "Noto Sans CJK SC";
    candidates = [
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
      "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ];
  }
  return { name, file: candidates.find((p) => fs.existsSync(p)) ?? null };
}

function burnSubtitles(videoIn: string, srtPath: string, outBurned: string): void {
  if (ffmpegHasSubtitlesFilter()) {
    // ───── Path A: libass-based subtitles filter ─────
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-burn-"));
    try {
      const tmpVideo = path.join(tmpDir, "in.mp4");
      const tmpSrt = path.join(tmpDir, "subs.srt");
      const tmpOut = path.join(tmpDir, "out.mp4");
      fs.copyFileSync(videoIn, tmpVideo);
      fs.copyFileSync(srtPath, tmpSrt);
      const style = `FontName=${cjkBurnFont().name},FontSize=18,PrimaryColour=&H00F4EAD0,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=40`;
      run("ffmpeg", [
        "-y", "-loglevel", "error",
        "-i", "in.mp4",
        "-vf", `subtitles=subs.srt:force_style='${style}'`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "copy", "out.mp4",
      ], tmpDir);
      fs.copyFileSync(tmpOut, outBurned);
      return;
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  // ───── Path B: drawtext fallback (libass not compiled) ─────
  const caps = ffmpegFilterCapabilities();
  if (!caps.hasDrawtext) {
    console.warn("[burn] ffmpeg has neither `subtitles` (libass) nor `drawtext` (libfreetype) filter.");
    console.warn("[burn] skipping burn-in — final.mp4 is unaffected. To enable: brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass --with-freetype");
    return;
  }
  console.warn("[burn] ffmpeg has no `subtitles` filter (libass not enabled). Falling back to drawtext.");

  const font = cjkBurnFont().file;
  if (!font) {
    console.warn("[burn] no usable CJK system font found for drawtext fallback — skipping burn-in (final.mp4 unaffected).");
    fs.copyFileSync(videoIn, outBurned);
    return;
  }

  const cues = parseSrtForBurn(srtPath);
  if (!cues.length) {
    fs.copyFileSync(videoIn, outBurned);
    return;
  }

  // Build a chained drawtext filter — one drawtext per cue, gated by `enable=between(t,start,end)`.
  // Escape colons in the font path for ffmpeg filter syntax.
  const fontfile = font.replace(/:/g, "\\:");
  const drawtexts = cues.map((c) => {
    const text = c.text.replace(/,/g, "\\,");  // commas separate filter options
    return (
      `drawtext=fontfile='${fontfile}':text='${text}':fontcolor=0xF4EAD0:fontsize=44:` +
      `box=1:boxcolor=0x00000088:boxborderw=12:` +
      `x=(w-text_w)/2:y=h-text_h-80:` +
      `enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'`
    );
  });
  const filter = drawtexts.join(",");

  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", videoIn,
    "-vf", filter,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "copy",
    outBurned,
  ], path.dirname(outBurned));
}


interface VoiceEntry {
  index: number;
  startSec: number;
  durationSec: number;
  file: string;
}

/**
 * Build a single voiceover.mp3 by stitching each scene's TTS mp3 with silent
 * padding so the start of each voice aligns with the scene's perceived start
 * on the main timeline. Each scene's voice is left-aligned within its window.
 *
 * `perceivedStarts` is a map of scene.index → actual on-screen start, which
 * differs from scene.startSec when xfade transitions overlap clips. If absent,
 * scene.startSec is used as-is (hard-cut concat path).
 */
function buildVoiceTrack(
  voiceTrackPath: string,
  totalSec: number,
  projectRoot: string,
  outPath: string,
  perceivedStarts?: Map<number, number>
): boolean {
  if (!fs.existsSync(voiceTrackPath)) return false;
  const track = JSON.parse(fs.readFileSync(voiceTrackPath, "utf8")) as {
    scenes: VoiceEntry[];
  };
  if (!track.scenes?.length) return false;

  const inputs = track.scenes.map((e) => path.resolve(projectRoot, e.file));
  const filterParts: string[] = [];
  inputs.forEach((_, i) => {
    const e = track.scenes[i];
    const startSec = perceivedStarts?.get(e.index) ?? e.startSec;
    const delayMs = Math.round(Math.max(0, startSec) * 1000);
    filterParts.push(`[${i}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${totalSec.toFixed(2)}[v${i}]`);
  });
  const mixInputs = track.scenes.map((_, i) => `[v${i}]`).join("");
  const mixLine = `${mixInputs}amix=inputs=${track.scenes.length}:dropout_transition=0:normalize=0:duration=longest[aout]`;

  const ffArgs: string[] = ["-y", "-loglevel", "error"];
  for (const f of inputs) ffArgs.push("-i", f);
  ffArgs.push("-filter_complex", filterParts.concat(mixLine).join(";"));
  ffArgs.push("-map", "[aout]");
  ffArgs.push("-t", totalSec.toFixed(2));
  ffArgs.push("-c:a", "libmp3lame", "-b:a", "192k");
  ffArgs.push(outPath);
  run("ffmpeg", ffArgs, path.dirname(outPath));
  return true;
}

/**
 * Given the SceneClip array (in render order) compute the perceived start
 * time of each scene after xfade overlaps. Scene 1 starts at 0; subsequent
 * scenes are pulled earlier by their transition duration.
 *
 * Returns { perceivedStarts: Map<sceneIndex, startSec>, perceivedTotalSec }.
 */
function computePerceivedTimeline(
  clips: SceneClip[],
  sceneIndices: number[]
): { perceivedStarts: Map<number, number>; perceivedTotalSec: number } {
  const map = new Map<number, number>();
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const isCut = c.transition === "cut";
    if (i === 0) {
      map.set(sceneIndices[i], 0);
      cursor = c.durationSec;
    } else {
      const tDur = isCut ? 0 : Math.min(c.transitionDur, c.durationSec * 0.4, clips[i - 1].durationSec * 0.4);
      const start = cursor - tDur;
      map.set(sceneIndices[i], start);
      cursor = start + c.durationSec;
    }
  }
  return { perceivedStarts: map, perceivedTotalSec: cursor };
}

/**
 * Mix voice + bgm + video into the final mp4.
 *
 *   videoIn:    finished concatenated video (no audio)
 *   voicePath:  optional voiceover mp3 covering full duration
 *   bgmPath:    optional bgm mp3 (any duration; will be looped/trimmed)
 *   outFinal:   path to write the final mp4 with audio
 *   totalSec:   total expected video duration
 *
 * Returns true on success, false if no audio sources were provided.
 */
function mixFinal(
  videoIn: string,
  voicePath: string | null,
  bgmPath: string | null,
  outFinal: string,
  totalSec: number
): boolean {
  if (!voicePath && !bgmPath) return false;
  const args: string[] = ["-y", "-loglevel", "error", "-i", videoIn];
  const filterParts: string[] = [];
  let inputIdx = 1;
  let voiceIdx = -1;
  let bgmIdx = -1;
  if (voicePath) {
    args.push("-i", voicePath);
    voiceIdx = inputIdx++;
    filterParts.push(`[${voiceIdx}:a]apad=whole_dur=${totalSec.toFixed(2)},atrim=duration=${totalSec.toFixed(2)},volume=1.0[voice]`);
  }
  if (bgmPath) {
    args.push("-stream_loop", "-1", "-i", bgmPath);
    bgmIdx = inputIdx++;
    // -18dB (~0.125) so bgm sits under voice
    filterParts.push(`[${bgmIdx}:a]atrim=duration=${totalSec.toFixed(2)},afade=t=in:st=0:d=1.2,afade=t=out:st=${(totalSec - 1.5).toFixed(2)}:d=1.5,volume=0.13[bgm]`);
  }

  let mixSpec: string;
  if (voicePath && bgmPath) {
    mixSpec = `[voice][bgm]amix=inputs=2:duration=longest:normalize=0[aout]`;
  } else if (voicePath) {
    mixSpec = `[voice]anull[aout]`;
  } else {
    mixSpec = `[bgm]anull[aout]`;
  }
  filterParts.push(mixSpec);

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", "0:v", "-map", "[aout]");
  args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(outFinal);
  run("ffmpeg", args, path.dirname(outFinal));
  return true;
}

export async function runRender(opts: RenderOpts): Promise<void> {
  const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));

  // ─── Approval gate ─────────────────────────────────────────────────
  // Rendering is irreversible (uses TTS/render compute), so require explicit
  // approval. `--force` overrides. Skip the gate during single-scene re-renders.
  if (!opts.force && opts.only == null && sb.stages.analyzed && !sb.stages.approved) {
    console.error(`
⚠ Storyboard is analyzed but NOT approved. Two options:
    1. Open output/storyboard.html and review, then:  pipeline approve
    2. Override:                                       pipeline render --force

   Tip: any 'pipeline analyze' or 'pipeline edit' resets approval; you re-approve once you're happy.
`);
    process.exit(2);
  }

  const ctx: RenderContext = {
    width: sb.project.width,
    height: sb.project.height,
    fps: sb.project.fps,
    projectRoot: opts.projectRoot,
  };

  const scenesDir = path.join(opts.outputDir, "scenes");
  fs.mkdirSync(scenesDir, { recursive: true });

  // ─── Build a render plan ────────────────────────────────────────────
  // Each Scene → either "cache hit" (skip), "skip-other" (only-flag), or
  // "render this with these args". Plan computation is synchronous and cheap.
  type Job = {
    scene: Scene;
    sceneDir: string;
    mp4Path: string;
    srcHash: string;
    out: ReturnType<MethodRenderer>;
  };
  const jobs: Job[] = [];
  const cachedPaths = new Map<number, string>(); // sceneIndex → existing mp4 path

  for (const scene of sb.scenes) {
    if (opts.only !== null && scene.index !== opts.only) {
      if (scene.renderedPath && fs.existsSync(path.resolve(opts.projectRoot, scene.renderedPath))) {
        cachedPaths.set(scene.index, path.resolve(opts.projectRoot, scene.renderedPath));
      }
      continue;
    }
    if (!scene.method) { console.warn(`[scene ${scene.index}] no method assigned — skipping.`); continue; }
    const renderer = METHOD_RENDERERS[scene.method];
    if (!renderer) { console.warn(`[scene ${scene.index}] method '${scene.method}' has no renderer — skipping.`); continue; }

    const out = renderer(scene, ctx);
    const srcHash = sha1(out.engine === "hyperframes" ? out.html : out.tsx + JSON.stringify(out.props ?? {}));
    const sceneName = `scene-${String(scene.index).padStart(3, "0")}`;
    const sceneDir = path.join(scenesDir, `${sceneName}.${srcHash}`);
    const mp4Path = path.join(scenesDir, `${sceneName}.mp4`);

    if (!opts.force && fs.existsSync(mp4Path) && scene.renderedPath && scene.renderedHash === srcHash) {
      console.log(`[scene ${scene.index}] cache hit, skipping.`);
      cachedPaths.set(scene.index, mp4Path);
      continue;
    }
    jobs.push({ scene, sceneDir, mp4Path, srcHash, out });
  }

  // ─── Execute jobs with bounded concurrency ──────────────────────────
  const workers = Math.max(1, opts.workers ?? 1);
  if (jobs.length > 1 && workers > 1) {
    console.log(`\n=== Rendering ${jobs.length} scenes with ${workers} worker(s) ===`);
  }
  const renderedByIndex = new Map<number, string>();

  /** Render one job. Throws on failure (caller decides how to record). */
  async function execute(job: Job): Promise<void> {
    const { scene, sceneDir, mp4Path, out } = job;
    console.log(`[scene ${scene.index}/${sb.scenes.length}] rendering via ${scene.method} (${out.engine})`);
    if (out.engine === "hyperframes") {
      renderHyperFramesScene(sceneDir, out.html, out.sideFiles, mp4Path);
    } else {
      renderRemotionScene(
        sceneDir, out.tsx, out.compId, out.props,
        ctx.width, ctx.height, ctx.fps, scene.durationSec, mp4Path, out.sideFiles,
      );
    }
  }

  if (workers <= 1) {
    // Sequential — preserve current behavior + readable logs.
    for (const job of jobs) {
      try {
        await execute(job);
        job.scene.renderedPath = path.relative(opts.projectRoot, job.mp4Path);
        job.scene.renderedHash = job.srcHash;
        job.scene.status = "rendered";
        renderedByIndex.set(job.scene.index, job.mp4Path);
      } catch (e) {
        job.scene.status = "failed";
        console.error(`[scene ${job.scene.index}] render failed:`, (e as Error).message);
      }
    }
  } else {
    // Concurrent — bounded pool. Each worker pulls the next job until empty.
    let cursor = 0;
    async function workerLoop(workerId: number): Promise<void> {
      while (true) {
        const i = cursor++;
        if (i >= jobs.length) return;
        const job = jobs[i];
        try {
          await execute(job);
          job.scene.renderedPath = path.relative(opts.projectRoot, job.mp4Path);
          job.scene.renderedHash = job.srcHash;
          job.scene.status = "rendered";
          renderedByIndex.set(job.scene.index, job.mp4Path);
        } catch (e) {
          job.scene.status = "failed";
          console.error(`[worker ${workerId}] scene ${job.scene.index} failed:`, (e as Error).message);
        }
      }
    }
    await Promise.all(Array.from({ length: workers }, (_, i) => workerLoop(i + 1)));
  }

  // Final rendered-paths list in scene order, mixing cache + freshly rendered.
  const renderedPaths: string[] = [];
  for (const scene of sb.scenes) {
    const p = renderedByIndex.get(scene.index) ?? cachedPaths.get(scene.index);
    if (p) renderedPaths.push(p);
  }

  // Update storyboard with rendered paths
  sb.stages.rendered = renderedPaths.length === sb.scenes.length;
  fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));

  if (opts.only === null && renderedPaths.length === sb.scenes.length) {
    const silentPath = path.join(opts.outputDir, "final-silent.mp4");
    const finalPath = path.join(opts.outputDir, "final.mp4");

    // Choose stitch path: pure concat (fast) if every scene transition is "cut",
    // otherwise xfade chain (slower but supports fade/wipe/dip).
    const clips: SceneClip[] = sb.scenes.map((sc, i) => ({
      path: path.resolve(opts.projectRoot, sc.renderedPath!),
      durationSec: sc.durationSec,
      transition: i === 0 ? "cut" : (sc.transition ?? "cut"),
      transitionDur: sc.transitionDur ?? (sc.transition === "dip-to-black" ? 0.6 : 0.4),
    }));
    const anyTransition = clips.some((c) => c.transition !== "cut");
    const sceneIndices = sb.scenes.map((s) => s.index);
    let perceivedStarts: Map<number, number> | undefined;
    let perceivedTotal: number;
    if (anyTransition) {
      console.log(`\n=== Stitching ${clips.length} scenes WITH transitions → ${silentPath} ===`);
      stitchScenesWithTransitions(clips, silentPath);
      const tl = computePerceivedTimeline(clips, sceneIndices);
      perceivedStarts = tl.perceivedStarts;
      perceivedTotal = tl.perceivedTotalSec;
      console.log(`   perceived total (after xfades): ${perceivedTotal.toFixed(2)}s (raw=${(sb.scenes.at(-1)?.endSec ?? 0).toFixed(2)}s)`);
    } else {
      console.log(`\n=== Stitching ${clips.length} scenes (all cuts) → ${silentPath} ===`);
      stitchScenes(renderedPaths, silentPath);
      perceivedTotal = sb.scenes.at(-1)?.endSec ?? 0;
    }

    // Audio mix step — uses output/voice-track.json (from `pipeline tts`)
    // and output/bgm.mp3 (from `pipeline bgm`) if they exist. With transitions,
    // each scene's voice starts at its PERCEIVED time (xfades pull clips earlier).
    const voiceTrackPath = path.join(opts.outputDir, "voice-track.json");
    const bgmPath = path.join(opts.outputDir, "bgm.mp3");
    const totalSec = perceivedTotal;

    let voiceMixedPath: string | null = null;
    if (fs.existsSync(voiceTrackPath)) {
      voiceMixedPath = path.join(opts.outputDir, "voice-mixed.mp3");
      console.log(`=== Building voice track (${totalSec.toFixed(1)}s with ${perceivedStarts ? "perceived" : "raw"} delays) ===`);
      const built = buildVoiceTrack(voiceTrackPath, totalSec, opts.projectRoot, voiceMixedPath, perceivedStarts);
      if (!built) voiceMixedPath = null;
    }
    const bgmExists = fs.existsSync(bgmPath);

    if (voiceMixedPath || bgmExists) {
      console.log(`=== Mixing audio → ${finalPath}  (voice=${!!voiceMixedPath}, bgm=${bgmExists}) ===`);
      mixFinal(silentPath, voiceMixedPath, bgmExists ? bgmPath : null, finalPath, totalSec);
      console.log(`✓ Final video with audio: ${finalPath}`);
    } else {
      // No audio sources — silent video is the final
      fs.copyFileSync(silentPath, finalPath);
      console.log(`✓ Final video (silent): ${finalPath}`);
      console.log(`  (run \`pipeline tts\` and/or \`pipeline bgm\` then re-render to add audio)`);
    }

    // Always write a sidecar SRT covering ALL scenes — works in any video player.
    // Uses the perceived timeline (which accounts for xfade overlaps), so cues
    // align with what the viewer actually sees.
    {
      const sidecarSrt = path.join(opts.outputDir, "final.srt");
      const lines: string[] = [];
      const t = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.round((sec - Math.floor(sec)) * 1000);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
      };
      let idx = 1;
      for (const sc of sb.scenes) {
        const perceivedStart = perceivedStarts?.get(sc.index) ?? sc.startSec;
        const perceivedEnd = perceivedStart + sc.durationSec;
        lines.push(`${idx++}`, `${t(perceivedStart)} --> ${t(perceivedEnd)}`, sc.text, "");
      }
      fs.writeFileSync(sidecarSrt, lines.join("\n"));
      console.log(`✓ Sidecar subtitles: ${sidecarSrt} (open in VLC/QuickTime alongside the mp4)`);
    }

    // Optional: also try to BURN subtitles for any scene flagged burnSubtitle=true.
    // Only renders if local ffmpeg has libass / libfreetype.
    const burnedScenes = sb.scenes.filter((sc) => sc.burnSubtitle);
    if (burnedScenes.length) {
      const burnedSrt = path.join(opts.outputDir, "burned-cues.srt");
      const lines: string[] = [];
      const t = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.round((sec - Math.floor(sec)) * 1000);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
      };
      let idx = 1;
      for (const sc of burnedScenes) {
        const perceivedStart = perceivedStarts?.get(sc.index) ?? sc.startSec;
        const perceivedEnd = perceivedStart + sc.durationSec;
        lines.push(`${idx++}`, `${t(perceivedStart)} --> ${t(perceivedEnd)}`, sc.text, "");
      }
      fs.writeFileSync(burnedSrt, lines.join("\n"));
      const burnedOut = path.join(opts.outputDir, "final-subtitled.mp4");
      console.log(`=== Attempt burning subtitles for ${burnedScenes.length} flagged scene(s) → ${burnedOut} ===`);
      try {
        burnSubtitles(finalPath, burnedSrt, burnedOut);
        if (fs.existsSync(burnedOut)) {
          console.log(`✓ Final with burned subtitles: ${burnedOut}`);
        } else {
          console.log(`  (burn-in skipped — see warning above; sidecar final.srt still produced)`);
        }
      } catch (e) {
        console.warn(`[burn] burn-in failed but sidecar SRT is fine: ${(e as Error).message}`);
      }
    }
  } else if (opts.only !== null) {
    console.log(`\n✓ Single scene rendered. Run without --only to restitch the final video.`);
  } else {
    console.log(`\n⚠ Skipping stitch: ${sb.scenes.length - renderedPaths.length} scene(s) not rendered.`);
  }
}
