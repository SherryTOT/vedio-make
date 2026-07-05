// src/export_nle.ts
// Export the rendered storyboard as an editing timeline a real NLE can open:
//   - FCPXML 1.9 (Final Cut Pro / DaVinci Resolve / 剪映专业版 all import this)
//   - CMX3600 EDL (universal, simpler)
// Both place each scene's rendered MP4 back-to-back in storyboard order.
import fs from "node:fs";
import path from "node:path";
import type { Storyboard, Scene } from "./types.ts";

interface Clip { scene: Scene; name: string; abs: string; frames: number; }

function collectClips(sb: Storyboard, projectRoot: string): { clips: Clip[]; fps: number } {
  const fps = Math.max(1, Math.round(sb.project.fps || 30));
  const clips: Clip[] = [];
  for (const scene of sb.scenes) {
    if (!scene.renderedPath) continue;
    const abs = path.resolve(projectRoot, scene.renderedPath);
    if (!fs.existsSync(abs)) continue;
    const frames = Math.max(1, Math.round((scene.durationSec || 0) * fps));
    clips.push({ scene, name: `scene-${String(scene.index).padStart(3, "0")}`, abs, frames });
  }
  return { clips, fps };
}

function xmlEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
}
function fileUri(abs: string): string {
  return "file://" + abs.split("/").map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join("/");
}

/** Audio stems that carry the finished sound (the per-scene MP4s are silent —
 *  Remotion normalizes with -an and HyperFrames has no audio source, so voice/BGM
 *  live only in the final mix). Export them as timeline audio lanes so the NLE
 *  timeline isn't silent. voice-mixed.mp3 already has per-scene offsets baked in,
 *  so it spans the whole timeline at offset 0. */
function collectAudioStems(projectRoot: string): Array<{ role: string; name: string; abs: string }> {
  const outputDir = path.join(projectRoot, "output");
  const stems: Array<{ role: string; name: string; abs: string }> = [];
  const voice = path.join(outputDir, "voice-mixed.mp3");
  const bgm = path.join(outputDir, "bgm.mp3");
  if (fs.existsSync(voice)) stems.push({ role: "dialogue", name: "旁白", abs: voice });
  if (fs.existsSync(bgm)) stems.push({ role: "music", name: "配乐", abs: bgm });
  return stems;
}

export function buildFcpxml(sb: Storyboard, projectRoot: string): string {
  const { clips, fps } = collectClips(sb, projectRoot);
  const W = sb.project.width || 1080, H = sb.project.height || 1920;
  const title = sb.project.title || "Vedio Make";
  const total = clips.reduce((a, c) => a + c.frames, 0);
  const stems = collectAudioStems(projectRoot);

  const assets = clips.map((c, i) =>
    `    <asset id="a${i + 1}" name="${xmlEscape(c.name)}" uid="a${i + 1}" start="0s" duration="${c.frames}/${fps}s" hasVideo="1" videoSources="1" format="r1">\n` +
    `      <media-rep kind="original-media" src="${fileUri(c.abs)}"/>\n` +
    `    </asset>`
  ).join("\n");

  // Audio stem assets (whole-timeline). Anchored as connected clips on the first
  // spine clip below, one per lane, so an editor gets the finished sound.
  const audioAssets = stems.map((s, i) =>
    `    <asset id="aud${i + 1}" name="${xmlEscape(s.name)}" uid="aud${i + 1}" start="0s" duration="${total}/${fps}s" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000">\n` +
    `      <media-rep kind="original-media" src="${fileUri(s.abs)}"/>\n` +
    `    </asset>`
  ).join("\n");

  // Connected audio clips nest inside the clip they anchor to (FCPXML lanes), so
  // build the audio-lane XML once and attach it to the first video clip.
  const audioLanes = stems.map((s, i) =>
    `          <asset-clip ref="aud${i + 1}" lane="-${i + 1}" offset="0s" name="${xmlEscape(s.name)}" duration="${total}/${fps}s" audioRole="${s.role}"/>`
  ).join("\n");

  let offset = 0;
  const spine = clips.map((c, i) => {
    const open = `      <asset-clip ref="a${i + 1}" offset="${offset}/${fps}s" name="${xmlEscape(c.name)}" duration="${c.frames}/${fps}s" format="r1" tcFormat="NDF"`;
    offset += c.frames;
    // Attach the audio lanes to the FIRST clip (offset 0) so they span the timeline.
    if (i === 0 && audioLanes) return `${open}>\n${audioLanes}\n      </asset-clip>`;
    return `${open}/>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat${H}p${fps}" frameDuration="1/${fps}s" width="${W}" height="${H}" colorSpace="1-1-1 (Rec. 709)"/>
${assets}${audioAssets ? "\n" + audioAssets : ""}
  </resources>
  <library>
    <event name="Vedio Make">
      <project name="${xmlEscape(title)}">
        <sequence format="r1" duration="${total}/${fps}s" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

function tc(frames: number, fps: number): string {
  const f = frames % fps;
  const totalSec = Math.floor(frames / fps);
  const s = totalSec % 60, m = Math.floor(totalSec / 60) % 60, h = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

export function buildEdl(sb: Storyboard, projectRoot: string): string {
  const { clips, fps } = collectClips(sb, projectRoot);
  const title = (sb.project.title || "Vedio Make").replace(/[\r\n]/g, " ");
  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  // EDL audio-follows-video is unreliable across NLEs, so the finished sound is
  // noted here (import the stems manually) rather than emitted as fragile AA
  // events. FCPXML carries the audio lanes properly — prefer it when possible.
  const stems = collectAudioStems(projectRoot);
  if (stems.length) {
    for (const s of stems) lines.push(`* AUDIO (${s.role}): ${path.basename(s.abs)} — 从 output/ 手动导入到音频轨,对齐到 00:00:00:00`);
    lines.push("");
  }
  // Clips are placed strictly back-to-back. If the storyboard uses xfade
  // transitions, final.mp4 is SHORTER than this timeline (clips overlap) — the
  // EDL represents the cut version; trim transitions in the NLE to match.
  if (sb.scenes.some((s) => s.transition && s.transition !== "cut")) {
    lines.push("* NOTE: 分镜含转场(fade/wipe 等);本 EDL 按硬切排列,时长略长于 final.mp4。", "");
  }
  let rec = 0;
  clips.forEach((c, i) => {
    const recIn = tc(rec, fps), recOut = tc(rec + c.frames, fps);
    const srcIn = tc(0, fps), srcOut = tc(c.frames, fps);
    lines.push(`${String(i + 1).padStart(3, "0")}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`* FROM CLIP NAME: ${path.basename(c.abs)}`);
    lines.push("");
    rec += c.frames;
  });
  return lines.join("\n");
}

export function exportSummary(sb: Storyboard, projectRoot: string): { clips: number; unrendered: number } {
  const { clips } = collectClips(sb, projectRoot);
  const unrendered = sb.scenes.filter((s) => !s.renderedPath).length;
  return { clips: clips.length, unrendered };
}
