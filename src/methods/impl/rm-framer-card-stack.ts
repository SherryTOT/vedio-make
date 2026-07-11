import { type MethodRenderer } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// rm-framer-card-stack — Framer Motion spring cards (Remotion)
// ──────────────────────────────────────────────────────────────────────────
export const rmFramerCardStack: MethodRenderer = (scene, ctx) => {
  // Parse "title：A、B、C" or just "A、B、C"
  const text = scene.text;
  const colonMatch = text.match(/^(.+?)[：:]\s*(.+)$/);
  const heading = colonMatch ? colonMatch[1].trim() : "";
  const itemsRaw = (colonMatch ? colonMatch[2] : text)
    .split(/[、,，·]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items = itemsRaw.length ? itemsRaw : [text];

  return {
    engine: "remotion",
    compId: "Scene",
    props: { heading, items, durationSec: scene.durationSec },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";

type Props = { heading: string; items: string[]; durationSec: number };

export const Scene: React.FC<Props> = ({ heading, items }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const headOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const headY = interpolate(frame, [0, 18], [22, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  const cardCount = items.length;
  const cardW = Math.min(380, (width - 240 - (cardCount - 1) * 32) / cardCount);
  const cardH = 360;
  const gap = 32;
  const totalW = cardCount * cardW + (cardCount - 1) * gap;
  const startX = (width - totalW) / 2;
  const cardY = (height - cardH) / 2 + 60;

  return (
    <AbsoluteFill style={{
      background: "${ctx.design.paper}",
      color: "${ctx.design.ink}",
      fontFamily: "-apple-system, 'PingFang SC', sans-serif",
    }}>
      {heading && (
        <div style={{
          position: "absolute", left: 0, right: 0, top: 90, textAlign: "center",
          fontSize: 52, fontWeight: 500, letterSpacing: "0.04em",
          opacity: headOpacity, transform: \`translateY(\${headY}px)\`,
        }}>
          {heading}
        </div>
      )}

      {items.map((label, i) => {
        const startFrame = 8 + i * 7;
        const s = spring({
          frame: frame - startFrame, fps,
          config: { damping: 14, stiffness: 180, mass: 0.6 },
          durationInFrames: 38,
        });
        const op = interpolate(frame, [startFrame, startFrame + 8], [0, 1], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp",
        });
        const y = (1 - s) * 80;
        const rot = (1 - s) * (i % 2 === 0 ? -8 : 8);
        const x = startX + i * (cardW + gap);
        const isMiddle = cardCount >= 3 && i === Math.floor(cardCount / 2);

        return (
          <div key={i} style={{
            position: "absolute",
            left: x, top: cardY + y,
            width: cardW, height: cardH,
            transform: \`rotate(\${rot}deg) scale(\${0.85 + s * 0.15})\`,
            opacity: op,
            borderRadius: 16,
            background: "${ctx.design.pw}",
            border: \`1px solid ${ctx.design.line}\`,
            borderLeft: \`4px solid \${isMiddle ? "${ctx.design.accent}" : "${ctx.design.accent2}"}\`,
            boxShadow: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
          }}>
            <div style={{
              fontSize: 22, color: isMiddle ? "${ctx.design.accent}" : "${ctx.design.muted}",
              letterSpacing: "0.32em",
            }}>· {String(i + 1).padStart(2, "0")} ·</div>
            <div style={{
              fontSize: 80, fontWeight: 600, letterSpacing: "0.06em",
              color: isMiddle ? "${ctx.design.accent}" : "${ctx.design.ink}",
            }}>{label}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
`,
  };
};
