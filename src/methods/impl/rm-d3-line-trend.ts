import { type MethodRenderer } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// rm-d3-line-trend — D3 timeseries line chart (Remotion)
// ──────────────────────────────────────────────────────────────────────────
export const rmD3LineTrend: MethodRenderer = (scene, ctx) => {
  const PALETTE = [ctx.design.accent, ctx.design.ink, ctx.design.accent2, ctx.design.muted, "#3f8f5e", "#c9a05e"];
  const real = scene.data?.years && scene.data.series;
  const data = real
    ? {
        years: scene.data!.years!.map(String),
        series: scene.data!.series!.map((s, i) => ({
          name: String(s.name),
          color: s.color || PALETTE[i % PALETTE.length],
          values: s.values.map(Number),
        })),
      }
    : {
        // Visibly-placeholder sample. Colors come from the design's chartPalette
        // (NOT a hardcoded gold/purple AI palette — the old one literally tripped
        // the 土味 lint's ai-palette rule on the registry's own output).
        years: ["2018", "2019", "2020", "2021", "2022", "2023", "2024"],
        series: [
          { name: "示例 A", color: PALETTE[0], values: [1.0, 1.2, 1.4, 1.6, 1.9, 2.2, 2.5] },
          { name: "示例 B", color: PALETTE[1], values: [0.20, 0.30, 0.40, 0.50, 0.60, 0.65, 0.70] },
          { name: "示例 C", color: PALETTE[2], values: [0.05, 0.10, 0.20, 0.40, 0.60, 0.80, 0.95] },
          { name: "示例 D", color: PALETTE[3], values: [0.15, 0.20, 0.25, 0.28, 0.30, 0.32, 0.33] },
        ],
      };
  return {
    engine: "remotion",
    compId: "Scene",
    props: { title: scene.text, data, durationSec: scene.durationSec },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { scaleLinear, scalePoint, line as d3line, max } from "d3";

type Series = { name: string; color: string; values: number[] };
type Data = { years: string[]; series: Series[] };
type Props = { title: string; data: Data; durationSec: number };

export const Scene: React.FC<Props> = ({ title, data }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const marginTop = 200, marginBottom = 100, marginX = 140;
  const chartW = width - marginX * 2;
  const chartH = height - marginTop - marginBottom;

  const x = scalePoint<string>().domain(data.years).range([0, chartW]).padding(0.1);
  const yMax = max(data.series.flatMap((s) => s.values)) ?? 1;
  const y = scaleLinear().domain([0, yMax * 1.1]).range([chartH, 0]);

  const titleOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [0, 18], [22, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  // Draw lines: each series animates its path stroke-dashoffset from full to 0
  return (
    <AbsoluteFill style={{
      background: "${ctx.design.paper}",
      color: "${ctx.design.ink}",
      fontFamily: "-apple-system, 'PingFang SC', sans-serif",
    }}>
      <div style={{
        position: "absolute", left: marginX, top: 70,
        fontSize: 56, fontWeight: 500, letterSpacing: "0.04em",
        opacity: titleOpacity, transform: \`translateY(\${titleY}px)\`,
      }}>{title}</div>

      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {/* Y gridlines */}
        {y.ticks(4).map((tick) => (
          <g key={tick} transform={\`translate(\${marginX},\${marginTop + y(tick)})\`}>
            <line x2={chartW} stroke="${ctx.design.line}" strokeDasharray="6 8" />
            <text x={-16} y={6} fill="${ctx.design.muted}" fontSize={18} textAnchor="end" fontVariantNumeric="tabular-nums">
              {tick.toFixed(1)}M
            </text>
          </g>
        ))}
        {/* X labels */}
        {data.years.map((yr) => (
          <text key={yr} x={marginX + (x(yr) ?? 0)} y={marginTop + chartH + 36}
            fill="${ctx.design.muted}" fontSize={20} textAnchor="middle" letterSpacing="0.12em">{yr}</text>
        ))}

        <g transform={\`translate(\${marginX},\${marginTop})\`}>
          {data.series.map((s, si) => {
            const startFrame = 18 + si * 6;
            const drawProgress = interpolate(frame, [startFrame, startFrame + 40], [0, 1], {
              extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
            });
            // Build path
            const lineGen = d3line<{ year: string; v: number }>()
              .x((d) => x(d.year) ?? 0)
              .y((d) => y(d.v));
            const path = lineGen(s.values.map((v, i) => ({ year: data.years[i], v }))) ?? "";

            // For dash animation we'd need path length, but we can approximate by using x-clip
            const clipX = chartW * drawProgress;

            return (
              <g key={s.name}>
                <defs>
                  <clipPath id={\`clip-\${si}\`}>
                    <rect x={0} y={0} width={clipX} height={chartH} />
                  </clipPath>
                </defs>
                <path d={path} fill="none" stroke={s.color} strokeWidth={4} strokeLinecap="round"
                      clipPath={\`url(#clip-\${si})\`} />
                {/* End-cap dot at current line tip */}
                {s.values.map((v, i) => {
                  const px = x(data.years[i]) ?? 0;
                  if (px > clipX) return null;
                  const dotOp = interpolate(frame, [startFrame + i * 4, startFrame + i * 4 + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                  return <circle key={i} cx={px} cy={y(v)} r={4} fill={s.color} opacity={dotOp} />;
                })}
                {/* Legend label (series name at right edge) */}
                {drawProgress > 0.7 && (
                  <text x={chartW + 16} y={y(s.values.at(-1)!) + 6} fill={s.color} fontSize={22} fontWeight={500} opacity={(drawProgress - 0.7) / 0.3}>
                    {s.name}
                  </text>
                )}
              </g>
            );
          })}
          {/* Baseline axis */}
          <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke="${ctx.design.line}" />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
`,
  };
};
