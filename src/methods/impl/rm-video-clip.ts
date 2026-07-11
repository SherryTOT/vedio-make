import path from "node:path";
import { type MethodRenderer } from "../kit.ts";
import { hfCssFade } from "./hf-css-fade.ts";


// ──────────────────────────────────────────────────────────────────────────
// rm-video-clip — Remotion passthrough of a local mp4 with light grade
// ──────────────────────────────────────────────────────────────────────────
export const rmVideoClip: MethodRenderer = (scene, ctx) => {
  const videoAsset = (scene.assets ?? []).find((a) => /\.(mp4|mov|webm)$/i.test(a));
  if (!videoAsset) return hfCssFade(scene, ctx);
  const absPath = path.resolve(ctx.projectRoot, "assets", videoAsset);
  const fileName = path.basename(absPath);
  return {
    engine: "remotion",
    compId: "Scene",
    props: { title: scene.text, durationSec: scene.durationSec },
    sideFiles: { [`public/${fileName}`]: absPath },
    tsx: `import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, interpolate, Easing } from "remotion";

type Props = { title: string; durationSec: number };

export const Scene: React.FC<Props> = ({ title }) => {
  const frame = useCurrentFrame();
  const titleOpacity = interpolate(frame, [4, 22], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden", fontFamily: "-apple-system, 'PingFang SC', sans-serif" }}>
      <OffthreadVideo src={staticFile("${fileName}")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.55) 100%)" }} />
      <div style={{
        position: "absolute", left: 80, bottom: 70, maxWidth: "70%",
        fontSize: 48, fontWeight: 500, color: "#f4ead0", letterSpacing: "0.02em",
        textShadow: "0 4px 22px rgba(0,0,0,0.7)", opacity: titleOpacity,
      }}>{title}</div>
    </AbsoluteFill>
  );
};
`,
  };
};
