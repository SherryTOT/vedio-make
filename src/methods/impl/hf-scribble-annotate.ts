import { type MethodRenderer, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-scribble-annotate — hand-drawn arrows / circle annotation (GSAP + SVG).
//   MOTION.md §三.6: SVG paths stroke-draw 逐笔 (~0.6–0.8s each) with a hand-shake
//   wobble in a 2px ink/accent stroke; arrows draw along a wobbly path with a
//   head; a hand-drawn circle can ring the emphasised node. ≤3 drawn elements.
//   Deterministic wobble (seeded by index — NOT Math.random, seek-safe).
//
//   scene.text = a flow, nodes separated by "→" / "->" / newline
//     e.g. "用户 → 网关 → 模型".  Last node gets the emphasis circle.
//   2–4 nodes (≤3 arrows). Draws top→bottom for portrait.
// ──────────────────────────────────────────────────────────────────────────
export const hfScribbleAnnotate: MethodRenderer = (scene, ctx) => {
  const nodes = scene.text
    .split(/\s*(?:→|->|\n)\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  if (!nodes.length) nodes.push(scene.text.trim() || "");
  const N = nodes.length;
  const circleOn = N <= 3; // keep drawn elements ≤3 (arrows = N-1)

  const W = ctx.width, H = ctx.height, cx = W / 2;
  const nodeH = 128, gap = 118;
  const total = N * nodeH + (N - 1) * gap;
  const startY = Math.max(120, (H - total) / 2);
  const emW = (s: string) => { let w = 0; for (const ch of s) w += /[　-鿿]/.test(ch) ? 1 : 0.58; return w; };
  const fontPx = 46;
  const nodeW = (s: string) => Math.min(W - 240, Math.max(300, Math.round(emW(s) * fontPx) + 96));
  const cy = (i: number) => startY + i * (nodeH + gap) + nodeH / 2;

  // Deterministic wobbly polyline between two points (hand-drawn feel).
  const wobble = (x1: number, y1: number, x2: number, y2: number, seed: number) => {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, segs = 6;
    const pts: string[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, amp = Math.sin(t * Math.PI);
      const wob = Math.sin(seed * 1.7 + t * 9.3) * 5 * amp;
      pts.push(`${(x1 + dx * t + nx * wob).toFixed(1)},${(y1 + dy * t + ny * wob).toFixed(1)}`);
    }
    // arrowhead at the tip
    const ux = dx / len, uy = dy / len, px = -uy, py = ux, hl = 22, hw = 12;
    const wing1 = `${(x2 - ux * hl + px * hw).toFixed(1)},${(y2 - uy * hl + py * hw).toFixed(1)}`;
    const wing2 = `${(x2 - ux * hl - px * hw).toFixed(1)},${(y2 - uy * hl - py * hw).toFixed(1)}`;
    return `M${pts.join(" L")} M${x2.toFixed(1)},${y2.toFixed(1)} L${wing1} M${x2.toFixed(1)},${y2.toFixed(1)} L${wing2}`;
  };

  // Hand-drawn ring around a node (slightly open, overshooting — like a marker).
  const ring = (cxo: number, cyo: number, rx: number, ry: number, seed: number) => {
    const pts: string[] = [];
    const start = -0.5, end = Math.PI * 2 + 0.4; // overshoot past 360°
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const a = start + (end - start) * (i / steps);
      const wob = 1 + Math.sin(seed * 2.1 + a * 3.0) * 0.03;
      pts.push(`${(cxo + Math.cos(a) * rx * wob).toFixed(1)},${(cyo + Math.sin(a) * ry * wob).toFixed(1)}`);
    }
    return "M" + pts.join(" L");
  };

  const arrows = nodes.slice(0, -1).map((_, i) =>
    wobble(cx, cy(i) + nodeH / 2 + 10, cx, cy(i + 1) - nodeH / 2 - 10, i + 1));
  const ringPath = circleOn
    ? ring(cx, cy(N - 1), nodeW(nodes[N - 1]) / 2 + 26, nodeH / 2 + 24, 9)
    : "";

  const nodesHtml = nodes.map((n, i) => {
    const w = nodeW(n);
    return `  <div class="node" data-n="${i}" style="left:${(cx - w / 2).toFixed(0)}px; top:${(cy(i) - nodeH / 2).toFixed(0)}px; width:${w}px; height:${nodeH}px;">${escapeHtml(n)}</div>`;
  }).join("\n");

  const arrowSvg = arrows.map((d, i) =>
    `    <path class="arrow" data-i="${i}" d="${d}" fill="none" stroke="${ctx.design.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />`).join("\n");
  const ringSvg = ringPath
    ? `    <path class="ring" d="${ringPath}" fill="none" stroke="${ctx.design.accent}" stroke-width="3.5" stroke-linecap="round" pathLength="1" />` : "";

  const d = scene.durationSec;
  // nodes fade in (stagger), then each arrow draws 0.8s, then the ring 0.6s.
  const nodeScript = nodes.map((_, i) =>
    `    tl.fromTo('.node[data-n="${i}"]', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, ${(0.15 + i * 0.28).toFixed(2)});`).join("\n");
  const arrowScript = arrows.map((_, i) =>
    `    tl.fromTo('.arrow[data-i="${i}"]', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.8, ease: "power2.inOut" }, ${(0.5 + N * 0.28 + i * 0.7).toFixed(2)});`).join("\n");
  const ringScript = ringPath
    ? `    tl.fromTo('.ring', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: "power2.out" }, ${(0.5 + N * 0.28 + (N - 1) * 0.7 + 0.2).toFixed(2)});` : "";

  return {
    engine: "hyperframes",
    html: `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden;
    background: ${ctx.design.paper}; color: ${ctx.design.ink};
    font-family: ${ctx.design.serif}; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${W}px; height: ${H}px; }
  .node { position: absolute; display: flex; align-items: center; justify-content: center; text-align: center;
    background: ${ctx.design.pw}; border: 1.5px solid ${ctx.design.line}; border-radius: 14px;
    font-size: ${fontPx}px; font-weight: 600; color: ${ctx.design.ink}; padding: 0 24px; opacity: 0; z-index: 2; }
  svg.overlay { position: absolute; inset: 0; z-index: 1; }
  .arrow, .ring { stroke-dasharray: 1; stroke-dashoffset: 1; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${d}" data-width="${W}" data-height="${H}">
${nodesHtml}
  <svg class="overlay" width="${W}" height="${H}" data-layout-ignore>
${arrowSvg}
${ringSvg}
  </svg>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const T = ${d};
${nodeScript}
${arrowScript}
${ringScript}
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
