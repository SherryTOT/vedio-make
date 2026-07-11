import { type MethodRenderer } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// rm-d3-bar-chart — Remotion + D3 scale, animated bar chart
// ──────────────────────────────────────────────────────────────────────────
export const rmD3BarChart: MethodRenderer = (scene, ctx) => {
  // Prefer real data from `pipeline research` (scene.data.items); fall back to a
  // generic 5-bar sample so the scene still renders even when no research was run.
  const items = scene.data?.items?.length
    ? scene.data.items.slice(0, 7).map((it) => ({ label: String(it.label), value: Number(it.value) }))
    : [
        // Visibly-placeholder sample so it's obvious no real data was supplied
        // (run `pipeline research` / 检索数据, or fill scene.data) — not fabricated
        // numbers masquerading as fact.
        { label: "示例 A", value: 30 },
        { label: "示例 B", value: 45 },
        { label: "示例 C", value: 22 },
        { label: "示例 D", value: 38 },
        { label: "示例 E", value: 51 },
      ];

  return {
    engine: "remotion",
    compId: "Scene",
    props: {
      title: scene.text,
      data: items,
      durationSec: scene.durationSec,
      // spotlight param slot (MOTION §三末节): a bar index or label to emphasise —
      // the narrated bar染 accent, the rest drop to 35% opacity. null = all lit.
      spotlight: (scene.data as any)?.spotlight ?? null,
    },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing, spring } from "remotion";
import { scaleLinear, scaleBand, max } from "d3";

type Item = { label: string; value: number };
type Props = { title: string; data: Item[]; durationSec: number; spotlight: number | string | null };

export const Scene: React.FC<Props> = ({ title, data, spotlight }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const marginTop = 200;
  const marginBottom = 100;
  const marginX = 120;
  const chartW = width - marginX * 2;
  const chartH = height - marginTop - marginBottom;

  const yMax = max(data, (d) => d.value) ?? 1;
  const x = scaleBand<string>().domain(data.map((d) => d.label)).range([0, chartW]).padding(0.32);
  const y = scaleLinear().domain([0, yMax * 1.1]).range([chartH, 0]);

  const titleOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [0, 18], [22, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  return (
    <AbsoluteFill style={{
      background: "${ctx.design.paper}",
      color: "${ctx.design.ink}",
      fontFamily: "-apple-system, 'PingFang SC', 'Source Han Sans SC', sans-serif",
    }}>
      <div style={{
        position: "absolute", left: marginX, top: 70,
        fontSize: 56, fontWeight: 500, letterSpacing: "0.04em",
        opacity: titleOpacity, transform: \`translateY(\${titleY}px)\`,
      }}>{title}</div>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <g transform={\`translate(\${marginX},\${marginTop})\`}>
          {data.map((d, i) => {
            const startFrame = 20 + i * 6;
            const progress = interpolate(frame, [startFrame, startFrame + 26], [0, 1], {
              extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
            });
            const barH = (chartH - y(d.value)) * progress;
            const barY = chartH - barH;
            const landScale = spring({ frame: frame - (startFrame + 24), fps, config: { damping: 12, stiffness: 200 }, durationInFrames: 18 });
            const anySpot = spotlight !== null && spotlight !== undefined;
            const isSpot = anySpot && (spotlight === i || spotlight === d.label);
            const barFill = isSpot ? "${ctx.design.accent}"
              : anySpot ? "${ctx.design.accent2}"
              : (d.value === yMax ? "${ctx.design.accent}" : "${ctx.design.accent2}");
            return (
              <g key={d.label} transform={\`translate(\${x(d.label)},0)\`} opacity={anySpot && !isSpot ? 0.35 : 1}>
                <rect x={0} y={barY} width={x.bandwidth()} height={barH} rx={4}
                  fill={barFill}
                  style={{ transformOrigin: \`50% \${chartH}px\`, transform: \`scaleY(\${landScale < 1 ? 1 + (1 - landScale) * 0.05 : 1})\` }}
                />
                <text x={x.bandwidth() / 2} y={barY - 14} textAnchor="middle" fill={isSpot || d.value === yMax ? "${ctx.design.accent}" : "${ctx.design.ink}"} fontSize="36" fontWeight="500" opacity={progress} fontFamily="ui-monospace, 'SF Mono', Menlo, monospace" fontVariantNumeric="tabular-nums">
                  {(d.value * progress).toFixed(1)}
                </text>
                <text x={x.bandwidth() / 2} y={chartH + 40} textAnchor="middle" fill="${ctx.design.muted}" fontSize="22" letterSpacing="0.12em" opacity={progress}>
                  {d.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
`,
  };
};
