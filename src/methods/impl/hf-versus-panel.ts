import { type MethodRenderer, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-versus-panel — A vs B (up to 3 columns) parameter pull-table.
//   MOTION.md §三.4: the two sides slide in from opposite edges (0.6s, stagger
//   0.1s); parameter rows light up one by one (0.35s each); the winning cell in
//   a row is染 accent + scale 1.04 spring; the losing column dims to 0.85.
//
//   scene.text convention (newline-separated):
//     line 1  — column titles, "AI Switch|竞品 X"  (2 or 3 titles, | separated)
//     line 2+ — a parameter row, "月费|¥0*|¥99"     (label | val per column;
//               a trailing * on a value marks it the winner of that row)
//   The hero column (fully lit) is the one that wins the most rows.
// ──────────────────────────────────────────────────────────────────────────
export const hfVersusPanel: MethodRenderer = (scene, ctx) => {
  const lines = scene.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const titles = (lines[0] || "A|B").split("|").map((s) => s.trim());
  const cols = Math.min(Math.max(titles.length, 2), 3);
  while (titles.length < cols) titles.push("");

  type Row = { label: string; vals: string[]; win: number };
  const rows: Row[] = lines.slice(1).map((ln) => {
    const parts = ln.split("|").map((s) => s.trim());
    const label = parts[0] || "";
    const vals: string[] = [];
    let win = -1;
    for (let c = 0; c < cols; c++) {
      const raw = parts[c + 1] || "";
      if (/\*$/.test(raw)) win = c;
      vals.push(raw.replace(/\*$/, "").trim());
    }
    return { label, vals, win };
  }).filter((r) => r.label || r.vals.some(Boolean));

  // Hero column = most row wins (ties → column 0).
  const wins = new Array(cols).fill(0);
  for (const r of rows) if (r.win >= 0) wins[r.win]++;
  let hero = 0;
  for (let c = 1; c < cols; c++) if (wins[c] > wins[hero]) hero = c;

  // Per-column entrance offset: col 0 from left, last from right, middle rises.
  const enterFrom = (c: number): string =>
    c === 0 ? "{ x: -70, opacity: 0 }" : c === cols - 1 ? "{ x: 70, opacity: 0 }" : "{ y: 44, opacity: 0 }";

  const d = scene.durationSec;
  const rowStart = 0.7;
  const rowStagger = Math.min(0.5, Math.max(0.28, (d - rowStart - 0.4) / Math.max(1, rows.length)));

  const isNum = (s: string) => /[\d.]/.test(s);

  const headerHtml = titles.map((t, c) =>
    `<div class="col-title side-${c} ${c === hero ? "hero" : "dim"}">${escapeHtml(t)}</div>`).join("");

  const rowsHtml = rows.map((r, i) => {
    const cells = r.vals.map((v, c) =>
      `<div class="pval side-${c} ${c === r.win ? "win" : ""} ${c !== hero ? "dim" : ""} ${isNum(v) ? "num" : ""}">${escapeHtml(v)}</div>`).join("");
    return `  <div class="prow" data-row="${i}">
    <div class="plabel">${escapeHtml(r.label)}</div>
    <div class="pvals">${cells}</div>
  </div>`;
  }).join("\n");

  // Per-row reveal + winner pop, at explicit times (few rows, seek-deterministic).
  const rowScript = rows.map((r, i) => {
    const t = (rowStart + i * rowStagger).toFixed(2);
    let s = `tl.fromTo('.prow[data-row="${i}"]', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: Math.min(0.35, T*0.3), ease: "power3.out" }, ${t});`;
    if (r.win >= 0) {
      s += `\n    tl.fromTo('.prow[data-row="${i}"] .win', { scale: 1 }, { scale: 1.04, duration: 0.32, ease: "back.out(1.6)" }, ${(rowStart + i * rowStagger + 0.12).toFixed(2)});`;
    }
    return "    " + s;
  }).join("\n");

  return {
    engine: "hyperframes",
    html: `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden;
    background: ${ctx.design.paper}; color: ${ctx.design.ink};
    font-family: ${ctx.design.sans}; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px;
    display: flex; flex-direction: column; justify-content: center; padding: 80px 120px; }
  .headers { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 40px; margin-bottom: 56px; }
  .col-title { font-family: ${ctx.design.serif}; font-size: 60px; font-weight: ${ctx.design.displayWeight};
    text-align: center; color: ${ctx.design.ink}; line-height: 1.1; }
  .col-title.hero { color: ${ctx.design.accent}; }
  .col-title.dim { opacity: 0.85; }
  .rows { display: flex; flex-direction: column; gap: 40px; }
  .prow { border-top: 1.5px solid ${ctx.design.line}; padding-top: 22px; }
  .plabel { font-size: 30px; font-weight: 600; letter-spacing: 0.06em; color: ${ctx.design.muted};
    text-align: center; margin-bottom: 16px; }
  .pvals { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 40px; }
  .pval { font-size: 46px; font-weight: 700; text-align: center; color: ${ctx.design.ink2}; line-height: 1.2; }
  .pval.num { font-variant-numeric: tabular-nums; }
  .pval.win { color: ${ctx.design.accent}; }
  .pval.dim { opacity: 0.85; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${d}" data-width="${ctx.width}" data-height="${ctx.height}">
  <div class="headers">${headerHtml}</div>
  <div class="rows">
${rowsHtml}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const T = ${d};
    // 两侧对向滑入 — columns enter from opposite edges, stagger 0.1s.
${titles.map((_, c) => `    tl.fromTo(".side-${c}", ${enterFrom(c)}, { x: 0, y: 0, opacity: ${c === hero ? 1 : 0.85}, duration: Math.min(0.6, T*0.5), ease: "power3.out" }, ${(c * 0.1).toFixed(2)});`).join("\n")}
    // 参数行逐行点亮 + 优势格 pop
${rowScript}
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
