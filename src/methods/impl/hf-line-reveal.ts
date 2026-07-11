import { type MethodRenderer, onLightCardText, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-line-reveal — clean LIGHT infographic: a white titled card with a
// multi-series line chart whose lines draw on left-to-right (snappy), with
// markers popping in along the draw front. Reverse-engineered from a
// Bilibili explainer's "亚洲各国GDP增速" data card. Data-driven via
// scene.data { years, series:[{name,color,values}] }.
// ──────────────────────────────────────────────────────────────────────────
export const hfLineReveal: MethodRenderer = (scene, ctx) => {
  const W = ctx.width, H = ctx.height;
  const PALETTE = ctx.design.chartPalette;
  const hasData = scene.data?.years && scene.data?.series;
  const years: string[] = hasData
    ? scene.data!.years!.map(String)
    : ["1990", "1991", "1992", "1993", "1994", "1995", "1996", "1997", "1998"];
  const series = hasData
    ? scene.data!.series!.map((s, i) => ({
        name: String(s.name),
        color: s.color || PALETTE[i % PALETTE.length],
        values: s.values.map(Number),
      }))
    : [
        { name: "泰国",       color: PALETTE[0], values: [11.0, 8.0, 8.0, 8.5, 9.0, 9.2, 9.0, 8.6, 9.0] },
        { name: "印度尼西亚", color: PALETTE[1], values: [9.0, 8.9, 7.2, 7.3, 7.5, 8.2, 7.8, 8.0, 8.3] },
        { name: "马来西亚",   color: PALETTE[2], values: [9.0, 9.5, 8.9, 9.9, 9.2, 9.8, 10.0, 9.6, 10.2] },
        { name: "韩国",       color: PALETTE[3], values: [9.8, 9.4, 5.9, 6.1, 8.5, 9.2, 8.8, 9.0, 9.4] },
        { name: "菲律宾",     color: PALETTE[4], values: [3.0, 0.5, 0.3, 2.1, 4.4, 4.7, 5.8, 5.5, 6.0] },
      ];

  const title = scene.text || "亚洲各国GDP增速";
  const subtitle = (scene.notes && scene.notes[0]) || `GDP GROWTH RATE · ${years[0]}–${years[years.length - 1]}`;

  // ── Geometry (computed in TS, baked into SVG) ──────────────────────────
  const n = years.length;
  const px0 = 250, px1 = W - 200, plotW = px1 - px0;
  const py0 = 360, py1 = H - 190, plotH = py1 - py0;
  const allV = series.flatMap((s) => s.values);
  const yMin = Math.min(0, Math.floor(Math.min(...allV)));
  const yMax = Math.ceil(Math.max(...allV) / 2) * 2 + 1;
  const X = (i: number) => px0 + (i * plotW) / (n - 1);
  const Y = (v: number) => py1 - ((v - yMin) / (yMax - yMin)) * plotH;

  const gridVals: number[] = [];
  for (let g = yMin; g <= yMax; g += 5) gridVals.push(g);

  const paths = series
    .map((s, si) => {
      const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
      return `<path class="ln ln-${si}" d="${d}" fill="none" stroke="${s.color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join("\n      ");
  const markers = series
    .map((s, si) =>
      s.values
        .map(
          (v, i) =>
            `<circle class="mk mk-${si}" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="6" fill="#fff" stroke="${s.color}" stroke-width="3" />`
        )
        .join("")
    )
    .join("\n      ");
  const grid = gridVals
    .map(
      (g) =>
        `<line x1="${px0}" x2="${px1}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}" stroke="${g === 0 ? "#c9ced8" : "#e6e9ef"}" stroke-width="${g === 0 ? 2 : 1}" stroke-dasharray="${g === 0 ? "0" : "2 7"}" /><text x="${px0 - 22}" y="${(Y(g) + 6).toFixed(1)}" fill="#9aa1ad" font-size="22" text-anchor="end" font-weight="600">${g}%</text>`
    )
    .join("\n      ");
  const xlabels = years
    .map(
      (yr, i) =>
        `<text x="${X(i).toFixed(1)}" y="${py1 + 44}" fill="#9aa1ad" font-size="22" text-anchor="middle" font-weight="600">'${yr.slice(2)}</text>`
    )
    .join("\n      ");
  const legend = series
    .map(
      (s) =>
        `<span class="chip"><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`
    )
    .join("");

  const dur = scene.durationSec;
  const drawAt = 0.35, drawDur = Math.min(0.62, dur * 0.42);

  return {
    engine: "hyperframes",
    html: `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@500;700;900&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${ctx.design.paper}; font-family: ${ctx.design.sans}; }
  #root { position: relative; width: ${W}px; height: ${H}px; }
  /* Dark backdrop with a faded sepia b-roll bleed on the far left (mirrors ref framing) */
  .backdrop { position: absolute; inset: 0; background: ${ctx.design.paper}; }
  .card {
    position: absolute; left: 70px; top: 56px; width: ${W - 140}px; height: ${H - 112}px;
    background: #ffffff; border-radius: 18px;
    border: 1px solid ${ctx.design.line};
    overflow: hidden;
  }
  .titleblk { position: absolute; left: 0; right: 0; top: 70px; text-align: center; }
  .t-hl { position: relative; display: inline-block; padding: 6px 22px; }
  .t-hl .bar {
    position: absolute; left: 0; right: 0; bottom: 8px; height: 26px;
    background: color-mix(in srgb, ${ctx.design.accent} 22%, transparent); border-radius: 4px; z-index: 0;
    transform: scaleX(0); transform-origin: 0 50%;
  }
  .t-hl span.tx { position: relative; z-index: 1; font-size: 60px; font-weight: 700; color: ${onLightCardText(ctx.design)}; letter-spacing: 0.02em; }
  .t-sub { margin-top: 12px; font-size: 22px; font-weight: 600; letter-spacing: 0.34em; color: #9aa1ad; }
  .legend { position: absolute; left: 0; right: 0; top: 232px; text-align: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 10px;
    margin: 0 9px; padding: 9px 20px; border-radius: 999px;
    background: #f3f5f8; color: #3a414e; font-size: 24px; font-weight: 700;
    opacity: 0; transform: translateY(8px);
  }
  .chip i { width: 16px; height: 16px; border-radius: 50%; display: inline-block; }
  svg { position: absolute; inset: 0; }
  .ln { filter: drop-shadow(0 3px 5px rgba(0,0,0,0.06)); }
  .mk { opacity: 0; }
  .gridg, .xlab { opacity: 0; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${dur}" data-width="${W}" data-height="${H}">
  <div class="backdrop" data-layout-ignore></div>
  <div class="card" id="card" data-layout-ignore>
    <div class="titleblk" id="tblk">
      <div class="t-hl" id="thl"><i class="bar" id="hlbar"></i><span class="tx">${escapeHtml(title)}</span></div>
      <div class="t-sub">${escapeHtml(subtitle)}</div>
    </div>
    <div class="legend" id="leg">${legend}</div>
    <svg width="${W}" height="${H}" data-layout-ignore>
      <g class="gridg" id="gridg">
      ${grid}
      </g>
      <g class="xlab" id="xlab">
      ${xlabels}
      </g>
      <g id="lines">
      ${paths}
      </g>
      <g id="dots">
      ${markers}
      </g>
    </svg>
  </div>

  <script>
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    var N = ${n};

    // Snappy card + heading entrance (it's basically a hard cut in the ref).
    tl.fromTo("#card", { opacity: 0, scale: 0.985, y: 12 }, { opacity: 1, scale: 1, y: 0, duration: 0.30, ease: "power3.out" }, 0);
    tl.fromTo("#tblk", { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.32, ease: "power3.out" }, 0.06);
    // Marker-pen highlight wipes in behind the heading.
    tl.fromTo("#hlbar", { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: "power2.inOut" }, 0.22);
    tl.fromTo(".gridg", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, 0.12);
    tl.fromTo(".xlab", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, 0.16);
    tl.to(".chip", { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: 0.05 }, 0.16);

    // THE EFFECT — lines draw on left-to-right (stroke-dashoffset), snappy.
    var lines = document.querySelectorAll(".ln");
    lines.forEach(function (p, i) {
      var L = p.getTotalLength();
      p.style.strokeDasharray = L;
      p.style.strokeDashoffset = L;
      tl.to(p, { strokeDashoffset: 0, duration: ${drawDur.toFixed(2)}, ease: "power2.out" }, ${drawAt} + i * 0.05);
      // Markers for this series pop in following the draw front.
      var mk = document.querySelectorAll(".mk-" + i);
      gsap.set(mk, { transformOrigin: "50% 50%" });
      tl.to(mk, { opacity: 1, scale: 1, duration: 0.22, ease: "back.out(2.2)",
                  stagger: ${drawDur.toFixed(2)} / (N - 1) }, ${drawAt} + i * 0.05 + 0.04);
    });
    gsap.set(".mk", { scale: 0.2 });

    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
