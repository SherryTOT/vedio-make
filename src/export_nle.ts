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

export function buildFcpxml(sb: Storyboard, projectRoot: string): string {
  const { clips, fps } = collectClips(sb, projectRoot);
  const W = sb.project.width || 1080, H = sb.project.height || 1920;
  const title = sb.project.title || "Vedio Make";
  const total = clips.reduce((a, c) => a + c.frames, 0);

  const assets = clips.map((c, i) =>
    `    <asset id="a${i + 1}" name="${xmlEscape(c.name)}" uid="a${i + 1}" start="0s" duration="${c.frames}/${fps}s" hasVideo="1" videoSources="1" format="r1">\n` +
    `      <media-rep kind="original-media" src="${fileUri(c.abs)}"/>\n` +
    `    </asset>`
  ).join("\n");

  let offset = 0;
  const spine = clips.map((c, i) => {
    const clip = `      <asset-clip ref="a${i + 1}" offset="${offset}/${fps}s" name="${xmlEscape(c.name)}" duration="${c.frames}/${fps}s" format="r1" tcFormat="NDF"/>`;
    offset += c.frames;
    return clip;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat${H}p${fps}" frameDuration="1/${fps}s" width="${W}" height="${H}" colorSpace="1-1-1 (Rec. 709)"/>
${assets}
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
