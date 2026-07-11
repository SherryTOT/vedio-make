import path from "node:path";
import { type MethodRenderer, onLightCardText } from "../kit.ts";
import { hfCssFade } from "./hf-css-fade.ts";


// ──────────────────────────────────────────────────────────────────────────
// rm-image-kenburns — Remotion, single image + non-linear pan/zoom
// ──────────────────────────────────────────────────────────────────────────
export const rmImageKenburns: MethodRenderer = (scene, ctx) => {
  // First image-like asset (any path, not just generated/) is the subject.
  const imgAsset = (scene.assets ?? []).find((a) => /\.(jpg|jpeg|png|webp)$/i.test(a));
  if (!imgAsset) {
    // Fall back to css-fade if no image — keeps the pipeline producing.
    return hfCssFade(scene, ctx);
  }
  const absPath = path.resolve(ctx.projectRoot, "assets", imgAsset);
  const fileName = path.basename(absPath);
  // Pick a kenburns spec from scene.motion (analyzer-set); fall back to mild in-zoom.
  // MOTION §三末节: fixed uniform push 1.03–1.08, NO in-out breathing ease.
  const m = scene.motion ?? { kind: "kenburns", direction: "in", intensity: "subtle" };
  const intensity = m.intensity === "strong" ? 0.08 : m.intensity === "medium" ? 0.06 : 0.04;
  const startScale = m.direction === "out" ? 1 + intensity : 1;
  const endScale = m.direction === "out" ? 1 : 1 + intensity;
  const fromX = m.direction === "left" ? intensity * 8 : m.direction === "right" ? -intensity * 8 : 0;
  const toX = m.direction === "left" ? -intensity * 8 : m.direction === "right" ? intensity * 8 : 0;

  return {
    engine: "remotion",
    compId: "Scene",
    props: {
      title: scene.text,
      durationSec: scene.durationSec,
      startScale, endScale, fromX, toX,
      ease: "linear",
    },
    sideFiles: { [`public/${fileName}`]: absPath },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing, staticFile } from "remotion";

type Props = {
  title: string; durationSec: number;
  startScale: number; endScale: number; fromX: number; toX: number; ease: string;
};

// Map ease names → Remotion Easing. Ken Burns is fixed uniform (linear) — no
// in-out breathing (MOTION §三末节); other names kept for safety only.
const EASE_MAP: Record<string, any> = {
  "linear":       Easing.linear,
  "power3.inOut": Easing.inOut(Easing.cubic),
  "power2.inOut": Easing.inOut(Easing.quad),
  "sine.inOut":   Easing.inOut(Easing.sin),
};

export const Scene: React.FC<Props> = ({ title, startScale, endScale, fromX, toX, ease }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const easing = EASE_MAP[ease] ?? Easing.linear;
  const t = frame / Math.max(1, durationInFrames - 1);
  const scale = interpolate(t, [0, 1], [startScale, endScale], { easing });
  const xPct  = interpolate(t, [0, 1], [fromX, toX], { easing });
  const titleOpacity = interpolate(frame, [6, 22], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [6, 28], [22, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ background: "${ctx.design.paper}", overflow: "hidden", fontFamily: "-apple-system, 'PingFang SC', sans-serif" }}>
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: \`url(\${staticFile("${fileName}")})\`,
        backgroundSize: "cover", backgroundPosition: \`\${50 + xPct}% 50%\`,
        transform: \`scale(\${scale})\`, transformOrigin: "50% 50%",
        filter: "saturate(0.92) brightness(0.85)",
      }} />
      {title && (
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: "12%",
          display: "flex", justifyContent: "center", padding: "0 120px",
          opacity: titleOpacity, transform: \`translateY(\${titleY}px)\`,
        }}>
          <span style={{
            fontSize: 60, fontWeight: 600, letterSpacing: "0.03em", textAlign: "center", lineHeight: 1.25,
            color: "${onLightCardText(ctx.design)}", background: "${ctx.design.paper}",
            padding: "14px 40px", borderRadius: 8,
          }}>{title}</span>
        </div>
      )}
    </AbsoluteFill>
  );
};
`,
  };
};
