import { type MethodRenderer } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// rm-d3-bar-race — ranked bars that overtake each other (Remotion + D3).
//   MOTION.md §三.1: on each reorder the bar's y-position shifts 0.8s
//   power2.inOut while its value rolls in sync; the new #1染 accent, the
//   displaced #1 falls back to accent2; reorder interval ≥1.2s; ≤8 bars.
//
//   Data: scene.data.years (the time steps) + scene.data.series ({name,
//   values[]}); each subject's values align to the steps. Placeholder if absent.
// ──────────────────────────────────────────────────────────────────────────
export const rmD3BarRace: MethodRenderer = (scene, ctx) => {
  const PALETTE = ctx.design.chartPalette;
  const real = scene.data?.years && scene.data.series;
  const raw = real
    ? {
        years: scene.data!.years!.map(String),
        series: scene.data!.series!.map((s, i) => ({
          name: String(s.name),
          color: s.color || PALETTE[i % PALETTE.length],
          values: s.values.map(Number),
        })),
      }
    : {
        years: ["2019", "2020", "2021", "2022", "2023"],
        series: [
          { name: "甲队", color: PALETTE[0], values: [12, 28, 30, 55, 92] },
          { name: "乙队", color: PALETTE[1], values: [20, 24, 48, 50, 60] },
          { name: "丙队", color: PALETTE[2], values: [8, 40, 44, 70, 78] },
          { name: "丁队", color: PALETTE[3], values: [30, 32, 35, 40, 48] },
          { name: "戊队", color: PALETTE[4], values: [5, 10, 22, 38, 66] },
        ],
      };
  // ≤8 bars (spec).
  const data = { years: raw.years, series: raw.series.slice(0, 8) };

  return {
    engine: "remotion",
    compId: "Scene",
    props: { title: scene.text, data, durationSec: scene.durationSec },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { scaleLinear, max } from "d3";

type Series = { name: string; color: string; values: number[] };
type Data = { years: string[]; series: Series[] };
type Props = { title: string; data: Data; durationSec: number };

export const Scene: React.FC<Props> = ({ title, data }) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const marginTop = 300, marginBottom = 120, marginX = 90;
  const chartW = width - marginX * 2;
  const chartH = height - marginTop - marginBottom;
  const N = data.series.length;
  const steps = data.years.length;
  // Cap row height + bar thickness so bars always read as HORIZONTAL rows (a race),
  // not tall rectangles when N is small; centre the group vertically.
  const rowH = Math.min(chartH / Math.max(N, 1), 200);
  const barH = Math.min(rowH * 0.55, 120);
  const groupOffsetY = Math.max(0, (chartH - rowH * N) / 2);
  const labelW = 250;                       // right-aligned name gutter
  const valueW = 180;                       // room for the value at the tip
  const xMax = max(data.series.flatMap((s) => s.values)) ?? 1;
  const x = scaleLinear().domain([0, xMax * 1.02]).range([0, chartW - labelW - valueW]);

  // Per-step ranks (0 = top) by value desc.
  const ranks = data.series.map(() => new Array(steps).fill(0));
  for (let k = 0; k < steps; k++) {
    const order = data.series.map((s, i) => ({ i, v: s.values[k] })).sort((a, b) => b.v - a.v);
    order.forEach((o, r) => { ranks[o.i][k] = r; });
  }

  const raceStart = Math.round(fps * 0.5);
  const transFrames = Math.max(Math.round(fps * 1.2),
    Math.floor((durationInFrames - raceStart - fps * 0.5) / Math.max(1, steps - 1)));
  const sp = Math.max(0, Math.min(steps - 1, (frame - raceStart) / transFrames));
  const k = Math.floor(sp), kNext = Math.min(k + 1, steps - 1), localT = sp - k;
  // y-move (rank shift) eases over the first 0.8s of each interval (power2.inOut).
  const moveEase = interpolate(localT, [0, Math.min(0.999, (fps * 0.8) / transFrames)], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const introOpacity = interpolate(frame, [0, raceStart], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "${ctx.design.paper}", color: "${ctx.design.ink}", fontFamily: "${ctx.design.sans.replace(/"/g, "'")}" }}>
      <div style={{ position: "absolute", left: marginX, top: 100, fontSize: 58, fontWeight: 600, letterSpacing: "0.02em" }}>{title}</div>
      <div style={{ position: "absolute", right: marginX, top: 96, fontSize: 96, fontWeight: 800,
        fontVariantNumeric: "tabular-nums", color: "${ctx.design.muted}", opacity: 0.5 }}>{data.years[Math.round(sp)]}</div>

      <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: introOpacity }}>
        <g transform={\`translate(\${marginX},\${marginTop})\`}>
          {data.series.map((s, i) => {
            const rankNow = ranks[i][k] + (ranks[i][kNext] - ranks[i][k]) * moveEase;
            const valueNow = s.values[k] + (s.values[kNext] - s.values[k]) * localT;
            const yTop = groupOffsetY + rankNow * rowH + (rowH - barH) / 2;
            const w = Math.max(2, x(valueNow));
            const rr = Math.round(rankNow);
            const fill = rr === 0 ? "${ctx.design.accent}" : rr === 1 ? "${ctx.design.accent2}" : "${ctx.design.ink2}";
            return (
              <g key={s.name} transform={\`translate(0,\${yTop})\`}>
                <text x={labelW - 18} y={barH / 2 + 12} textAnchor="end" fontSize={34} fontWeight={600} fill="${ctx.design.ink}">{s.name}</text>
                <rect x={labelW} y={0} width={w} height={barH} rx={6} fill={fill} opacity={rr <= 1 ? 1 : 0.9} />
                <text x={labelW + w + 16} y={barH / 2 + 13} fontSize={38} fontWeight={700}
                  fontVariantNumeric="tabular-nums" fill={fill}>{Math.round(valueNow)}</text>
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
