import { type MethodRenderer } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// rm-d3-line-draw — trend curve that draws itself (Remotion + D3).
//   MOTION.md §三.2: stroke-dashoffset draws the line in ~1.5s power4.out with a
//   cursor dot riding the tip; turning-point (拐点) annotations pop (scale 0→1
//   back.out(1.4), 0.4s) as the cursor reaches them; extra series stagger 0.3s
//   and sit at 35% opacity while the primary (current) line is full colour.
//
//   Data: scene.data.years + scene.data.series (values per year). series[0] is
//   the "current" line (full colour, cursor, annotations). Placeholder if absent.
// ──────────────────────────────────────────────────────────────────────────
export const rmD3LineDraw: MethodRenderer = (scene, ctx) => {
  const PALETTE = ctx.design.chartPalette;
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
        // Visibly-placeholder sample with a clear peak+trough so the 拐点
        // annotations have something to pop on. Colours = design chartPalette.
        years: ["90", "92", "94", "96", "98", "00", "02", "04"],
        series: [
          { name: "示例主线", color: PALETTE[0], values: [12, 18, 9, 22, 14, 28, 20, 33] },
          { name: "示例对照", color: PALETTE[1], values: [8, 10, 12, 13, 15, 16, 18, 19] },
        ],
      };

  return {
    engine: "remotion",
    compId: "Scene",
    props: { title: scene.text, data, durationSec: scene.durationSec },
    tsx: `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { scalePoint, scaleLinear, max, min } from "d3";

type Series = { name: string; color: string; values: number[] };
type Data = { years: string[]; series: Series[] };
type Props = { title: string; data: Data; durationSec: number };

export const Scene: React.FC<Props> = ({ title, data }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const marginTop = 240, marginBottom = 130, marginX = 150;
  const chartW = width - marginX * 2;
  const chartH = height - marginTop - marginBottom;

  const x = scalePoint<string>().domain(data.years).range([0, chartW]).padding(0.08);
  const yMin = Math.min(0, min(data.series.flatMap((s) => s.values)) ?? 0);
  const yMax = max(data.series.flatMap((s) => s.values)) ?? 1;
  const y = scaleLinear().domain([yMin, yMax * 1.12]).range([chartH, 0]);

  const titleOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [0, 18], [24, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  const drawFrames = Math.max(30, Math.round(fps * 1.5)); // ~1.5s draw (spec 1.2–2s)
  const startBase = Math.round(fps * 0.5);
  const staggerFrames = Math.round(fps * 0.3);

  const buildPts = (s: Series) => s.values.map((v, i) => ({ x: x(data.years[i]) ?? 0, y: y(v), v }));
  const cumFracOf = (pts: { x: number; y: number }[]) => {
    let total = 0; const seg: number[] = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y); seg.push(d); total += d; }
    const frac = [0]; let acc = 0; for (const d of seg) { acc += d; frac.push(total ? acc/total : 0); }
    return frac;
  };
  const pointAt = (pts: { x: number; y: number }[], frac: number[], p: number) => {
    if (p <= 0) return pts[0]; if (p >= 1) return pts[pts.length-1];
    for (let i = 1; i < pts.length; i++) {
      if (frac[i] >= p) { const t = (p - frac[i-1]) / ((frac[i] - frac[i-1]) || 1);
        return { x: pts[i-1].x + (pts[i].x - pts[i-1].x)*t, y: pts[i-1].y + (pts[i].y - pts[i-1].y)*t }; }
    }
    return pts[pts.length-1];
  };
  const toPath = (pts: { x: number; y: number }[]) => pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");

  return (
    <AbsoluteFill style={{ background: "${ctx.design.paper}", color: "${ctx.design.ink}", fontFamily: "${ctx.design.sans.replace(/"/g, "'")}" }}>
      <div style={{ position: "absolute", left: marginX, top: 90, fontSize: 58, fontWeight: 600,
        letterSpacing: "0.02em", opacity: titleOpacity, transform: \`translateY(\${titleY}px)\` }}>{title}</div>

      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {y.ticks(4).map((tick) => (
          <g key={tick} transform={\`translate(\${marginX},\${marginTop + y(tick)})\`}>
            <line x2={chartW} stroke="${ctx.design.line}" strokeDasharray="6 8" />
            <text x={-16} y={6} fill="${ctx.design.muted}" fontSize={18} textAnchor="end" fontVariantNumeric="tabular-nums">{tick}</text>
          </g>
        ))}
        {data.years.map((yr, i) => (i % 1 === 0) && (
          <text key={yr} x={marginX + (x(yr) ?? 0)} y={marginTop + chartH + 40} fill="${ctx.design.muted}"
            fontSize={20} textAnchor="middle" letterSpacing="0.1em">{yr}</text>
        ))}

        <g transform={\`translate(\${marginX},\${marginTop})\`}>
          <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke="${ctx.design.line}" />
          {data.series.map((s, si) => {
            const primary = si === 0;
            const start = startBase + si * staggerFrames;
            const progress = interpolate(frame, [start, start + drawFrames], [0, 1], {
              extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.poly(4)),
            });
            const pts = buildPts(s);
            const frac = cumFracOf(pts);
            const path = toPath(pts);
            const tip = pointAt(pts, frac, progress);
            // Turning points (拐点) on the primary line only.
            const turns: number[] = [];
            if (primary) for (let i = 1; i < s.values.length - 1; i++) {
              const a = s.values[i] - s.values[i-1], b = s.values[i+1] - s.values[i];
              if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) turns.push(i);
            }
            return (
              <g key={s.name} opacity={primary ? 1 : 0.35}>
                <path d={path} fill="none" stroke={s.color} strokeWidth={primary ? 6 : 4} strokeLinecap="round"
                  strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - progress} />
                {progress > 0.001 && progress < 0.999 && (
                  <circle cx={tip.x} cy={tip.y} r={primary ? 11 : 7} fill={s.color} />
                )}
                {primary && turns.map((ti) => {
                  // Pop keyed off the (eased) draw progress so the annotation
                  // fires exactly when the cursor reaches the turning point.
                  const pop = interpolate(progress, [frac[ti], Math.min(1, frac[ti] + 0.05)], [0, 1], {
                    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.4)),
                  });
                  if (pop <= 0) return null;
                  const px = pts[ti].x, py = pts[ti].y;
                  const above = s.values[ti] >= s.values[ti-1];
                  return (
                    <g key={ti} transform={\`translate(\${px},\${py}) scale(\${pop})\`}>
                      <circle r={9} fill="${ctx.design.paper}" stroke={s.color} strokeWidth={4} />
                      <text x={0} y={above ? -26 : 40} fill="${ctx.design.ink}" fontSize={30} fontWeight={700}
                        textAnchor="middle" fontVariantNumeric="tabular-nums">{s.values[ti]}</text>
                    </g>
                  );
                })}
                {progress > 0.72 && (
                  <text x={pts[pts.length-1].x + 18} y={pts[pts.length-1].y + 6} fill={s.color}
                    fontSize={24} fontWeight={600} opacity={(progress - 0.72) / 0.28}>{s.name}</text>
                )}
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
