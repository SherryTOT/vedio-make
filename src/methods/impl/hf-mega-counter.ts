import { type MethodRenderer, escapeHtml } from "../kit.ts";


// ──────────────────────────────────────────────────────────────────────────
// hf-mega-counter — full-screen single hero number (跑分 / 价格 / 百分比).
//   MOTION.md §三.3: number rolls 0→N in 1.2s power4.out; unit fades in 0.3s
//   later; comparison arrow pops LAST in design ok/alert; number ≥ 22% of the
//   screen height.
//
//   scene.text convention:  "value|suffix|label|sublabel|delta"
//     value    — 286 · $1,299 · 99.9   (may carry a $/¥/￥ prefix)
//     suffix   — % · 分 · GB            (the unit, fades in late)
//     label    — 香港隔夜拆借利率        (what the number is)
//     sublabel — 1997.10                (kicker above the number)
//     delta    — +18% · -5 · ↑12 · ↓3   (optional; sign/arrow → ok vs alert)
//   Numeric value counts 0→value (timeline-driven, seek-deterministic);
//   non-numeric (e.g. "10-15") shows literally.
// ──────────────────────────────────────────────────────────────────────────
export const hfMegaCounter: MethodRenderer = (scene, ctx) => {
  const p = scene.text.split("|").map((s) => s.trim());
  const rawVal = p[0] || scene.text;
  const suffix = p[1] || "";
  const label = p[2] || "";
  const sub = p[3] || "";
  const deltaRaw = p[4] || "";

  const m = rawVal.match(/^([^\d.\-]*)([\d,]+(?:\.\d+)?)$/);
  const prefix = m ? m[1] : "";
  const numStr = m ? m[2].replace(/,/g, "") : "";
  const target = m ? parseFloat(numStr) : NaN;
  const decimals = m && /\.\d/.test(numStr) ? numStr.split(".")[1].length : 0;
  const countable = m != null && isFinite(target);

  // Delta direction: leading + / ↑ / ▲ → up (ok); - / ↓ / ▼ → down (alert).
  const up = /^[+↑▲]/.test(deltaRaw);
  const down = /^[-↓▼]/.test(deltaRaw);
  const deltaText = deltaRaw.replace(/^[+\-↑↓▲▼]\s*/, "").trim();
  const deltaColor = down ? ctx.design.alert : ctx.design.ok;
  const showDelta = deltaRaw.length > 0;
  // Vector arrow (no emoji — MOTION 红线 4). Down arrow only when explicitly down.
  const arrowPath = down ? "M4,7 L20,7 L12,20 Z" : "M12,4 L4,17 L20,17 Z";

  // Number ≥ 22% of screen height (spec §三.3) — but the 左右≥120px safe area
  // (red line §一.6, 一票否决) WINS: a long value like "$1,299 起" scales down to
  // fit rather than bleeding off-frame. Short numbers hit the 22% ideal.
  const idealSize = Math.round(ctx.height * 0.22);
  const commafy = (n: number, dec: number): string => {
    const s = dec > 0 ? n.toFixed(dec) : String(Math.round(n));
    const parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  };
  const emWidth = (str: string): number => {
    let w = 0;
    for (const ch of str) {
      if (/\d/.test(ch)) w += 0.6;              // tabular digit
      else if (ch === "," || ch === ".") w += 0.3;
      else if (/[　-鿿]/.test(ch)) w += 1.05; // CJK
      else w += 0.58;
    }
    return w;
  };
  const finalNumStr = countable ? commafy(target, decimals) : rawVal;
  const totalEm = emWidth(finalNumStr)
    + (prefix ? emWidth(prefix) * 0.46 + 0.06 : 0)   // prefix rendered at 0.46×
    + (suffix ? emWidth(suffix) * 0.42 + 0.08 : 0);  // suffix rendered at 0.42×
  const usableW = ctx.width - 240;                   // 120px safe margin each side
  const fitSize = Math.floor(usableW / Math.max(totalEm, 0.5));
  const numSize = Math.max(Math.min(idealSize, fitSize), Math.round(ctx.height * 0.1));
  const d = scene.durationSec;
  const countDur = Math.min(1.2, d * 0.7);       // spec: 1.2s roll
  const countStart = 0.3;
  const unitStart = countStart + 0.3;            // spec: unit fades in 0.3s later
  const deltaStart = Math.min(d - 0.5, countStart + countDur + 0.1); // pops LAST

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
  .kicker { font-family: ${ctx.design.sans}; font-size: ${Math.round(numSize * 0.1)}px; font-weight: 600;
    letter-spacing: 0.18em; color: ${ctx.design.accent2}; opacity: 0; margin-bottom: ${Math.round(numSize * 0.06)}px; }
  .numwrap { display: flex; align-items: baseline; justify-content: center; opacity: 0; }
  .num { font-size: ${numSize}px; font-weight: ${ctx.design.displayWeight}; line-height: 0.92; letter-spacing: 0.005em;
    font-variant-numeric: tabular-nums; font-family: ${ctx.design.numberFamily === "serif" ? ctx.design.serif : ctx.design.sans}; color: ${ctx.design.ink}; }
  .pre { font-size: ${Math.round(numSize * 0.46)}px; font-weight: 700; color: ${ctx.design.accent}; margin-right: ${Math.round(numSize * 0.03)}px; }
  .suf { font-size: ${Math.round(numSize * 0.42)}px; font-weight: 600; color: ${ctx.design.accent}; margin-left: ${Math.round(numSize * 0.05)}px; opacity: 0; }
  .delta { display: inline-flex; align-items: center; gap: 10px; font-family: ${ctx.design.sans};
    font-size: ${Math.round(numSize * 0.14)}px; font-weight: 700; font-variant-numeric: tabular-nums;
    color: ${deltaColor}; opacity: 0; margin-top: ${Math.round(numSize * 0.08)}px; }
  .delta svg { width: ${Math.round(numSize * 0.16)}px; height: ${Math.round(numSize * 0.16)}px; fill: ${deltaColor}; }
  .label { font-family: ${ctx.design.sans}; font-size: ${Math.round(numSize * 0.12)}px; font-weight: 600;
    color: ${ctx.design.ink2}; opacity: 0; margin-top: ${Math.round(numSize * 0.1)}px; letter-spacing: 0.04em; text-align: center; padding: 0 120px; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${d}" data-width="${ctx.width}" data-height="${ctx.height}">
  ${sub ? `<div class="kicker">${escapeHtml(sub)}</div>` : ""}
  <div class="numwrap">
    ${prefix ? `<span class="pre">${escapeHtml(prefix)}</span>` : ""}
    <span class="num" id="num">${countable ? "0" : escapeHtml(rawVal)}</span>
    ${suffix ? `<span class="suf">${escapeHtml(suffix)}</span>` : ""}
  </div>
  ${showDelta ? `<div class="delta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${arrowPath}"></path></svg><span>${escapeHtml(deltaText)}</span></div>` : ""}
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
    tl.fromTo(".kicker", { opacity: 0, y: -14 },
      { opacity: 1, y: 0, duration: Math.min(0.45, T*0.4), ease: "power3.out" }, 0.15);
    tl.fromTo(".numwrap", { opacity: 0, scale: 0.92, y: 20 },
      { opacity: 1, scale: 1, y: 0, duration: Math.min(0.55, T*0.5), ease: "back.out(1.2)" }, ${countStart});
    ${countable ? `var st = { v: 0 };
    tl.to(st, { v: ${target}, duration: ${countDur.toFixed(2)}, ease: "power4.out",
      onUpdate: function(){ numEl.textContent = fmt(st.v); } }, ${countStart});` : ``}
    ${suffix ? `tl.fromTo(".suf", { opacity: 0, x: -8 },
      { opacity: 1, x: 0, duration: Math.min(0.4, T*0.35), ease: "power2.out" }, ${unitStart.toFixed(2)});` : ``}
    tl.fromTo(".label", { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: Math.min(0.5, T*0.45), ease: "power3.out" }, 0.65);
    ${showDelta ? `tl.fromTo(".delta", { opacity: 0, scale: 0.6, y: 10 },
      { opacity: 1, scale: 1, y: 0, duration: Math.min(0.4, T*0.35), ease: "back.out(1.5)" }, ${deltaStart.toFixed(2)});` : ``}
    window.__timelines["main"] = tl;
  </script>
</div>
</body>
</html>`,
  };
};
