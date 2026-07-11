import { type MethodRenderer, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-stat-counter — big count-up number callout (gold, glow ring), 小Lin说 style.
//   scene.text convention:  "300|%|香港隔夜拆借利率|1997.10"
//   → [value, suffix?, label?, sublabel?].  value may carry a $/¥ prefix.
//   Numeric value counts 0→value (timeline-driven, seek-deterministic);
//   non-numeric (e.g. "10-15") shows literally.
// ──────────────────────────────────────────────────────────────────────────
export const hfStatCounter: MethodRenderer = (scene, ctx) => {
  const p = scene.text.split("|").map((s) => s.trim());
  const rawVal = p[0] || scene.text;
  const suffix = p[1] || "";
  const label = p[2] || "";
  const sub = p[3] || "";
  const m = rawVal.match(/^([^\d.\-]*)([\d,]+(?:\.\d+)?)$/);
  const prefix = m ? m[1] : "";
  const numStr = m ? m[2].replace(/,/g, "") : "";
  const target = m ? parseFloat(numStr) : NaN;
  const decimals = m && /\.\d/.test(numStr) ? (numStr.split(".")[1].length) : 0;
  const countable = m != null && isFinite(target);
  const d = scene.durationSec;
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
    font-family: ${ctx.design.serif}; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    background: ${ctx.design.paper}; }
  .vig { display: none; }
  .ring { position: absolute; width: 740px; height: 740px; border-radius: 50%;
    border: 1.5px solid ${ctx.design.line}; opacity: 0; }
  .sub { font-family: ${ctx.design.sans}; font-size: 28px; font-weight: 600; letter-spacing: 0.16em; color: ${ctx.design.accent2}; opacity: 0; margin-bottom: 22px; }
  .numwrap { display: flex; align-items: baseline; opacity: 0; }
  .num { font-size: 260px; font-weight: ${ctx.design.displayWeight}; line-height: 1; letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums; font-family: ${ctx.design.numberFamily === "serif" ? ctx.design.serif : ctx.design.sans}; color: ${ctx.design.ink}; }
  .pre { font-size: 120px; font-weight: 700; color: ${ctx.design.accent}; margin-right: 10px; }
  .suf { font-size: 108px; font-weight: 600; color: ${ctx.design.accent}; margin-left: 14px; }
  .label { font-family: ${ctx.design.sans}; font-size: 40px; font-weight: 600; color: ${ctx.design.ink2}; opacity: 0; margin-top: 40px; letter-spacing: 0.04em; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${d}" data-width="${ctx.width}" data-height="${ctx.height}">
  <div class="vig" data-layout-ignore></div>
  <div class="ring" data-layout-ignore></div>
  ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}
  <div class="numwrap">
    ${prefix ? `<span class="pre">${escapeHtml(prefix)}</span>` : ""}
    <span class="num" id="num">${countable ? "0" : escapeHtml(rawVal)}</span>
    ${suffix ? `<span class="suf">${escapeHtml(suffix)}</span>` : ""}
  </div>
  ${label ? `<div class="label">${escapeHtml(label)}</div>` : ""}
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const T = ${d};
    const numEl = document.getElementById("num");
    const DEC = ${decimals};
    function fmt(v){ var n = DEC>0 ? v.toFixed(DEC) : String(Math.round(v));
      var parts = n.split("."); parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
      return parts.join("."); }
    tl.fromTo(".ring", { opacity: 0, scale: 0.6 },
      { opacity: 1, scale: 1, duration: Math.min(0.9, T*0.6), ease: "power2.out" }, 0.1);
    tl.fromTo(".sub", { opacity: 0, y: -14 },
      { opacity: 1, y: 0, duration: Math.min(0.5, T*0.4), ease: "power2.out" }, 0.2);
    tl.fromTo(".numwrap", { opacity: 0, scale: 0.8, y: 24 },
      { opacity: 1, scale: 1, y: 0, duration: Math.min(0.7, T*0.5), ease: "back.out(1.6)" }, 0.3);
    ${countable ? `var st = { v: 0 };
    tl.to(st, { v: ${target}, duration: Math.min(1.8, T*0.7), ease: "power2.out",
      onUpdate: function(){ numEl.textContent = fmt(st.v); } }, 0.35);` : ``}
    tl.fromTo(".label", { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: Math.min(0.55, T*0.45), ease: "power3.out" }, 0.6);
    // entrance only — concat handles the cut
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};

