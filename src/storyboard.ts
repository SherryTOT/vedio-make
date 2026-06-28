/**
 * `pipeline storyboard <storyboard.json>` — generates a human-readable
 * storyboard.html alongside the JSON. Cards per scene with timing, method,
 * fallback, asset refs, and a tier-color badge (S green / A yellow / B red).
 */

import fs from "node:fs";
import path from "node:path";
import { formatTime } from "./srt.ts";
import type { MethodDef, Storyboard } from "./types.ts";

// path.basename imported alongside path module above

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadCatalog(catalogPath: string): Map<string, MethodDef> {
  const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
    methods: MethodDef[];
  };
  return new Map(raw.methods.map((m) => [m.id, m]));
}

// ─── Editor option generators ───────────────────────────────────────────
function methodOptions(cat: Map<string, MethodDef>, current: string | null, sTierOnly = false): string {
  const opts: string[] = [];
  for (const m of cat.values()) {
    if (sTierOnly && m.reliability !== "S") continue;
    const sel = current === m.id ? " selected" : "";
    opts.push(`<option value="${m.id}"${sel}>[${m.reliability}] ${m.id} — ${m.label}</option>`);
  }
  return opts.join("");
}
const MINIMAX_VOICES = [
  "", "presenter_male", "presenter_female", "male-qn-jingying", "male-qn-qingse",
  "audiobook_male_1", "audiobook_female_1", "female-shaonv", "female-yujie", "female-chengshu",
];
function voiceOptions(current?: string | null): string {
  return MINIMAX_VOICES.map((v) => {
    const sel = (current ?? "") === v ? " selected" : "";
    const label = v === "" ? "(default — project voice)" : v;
    return `<option value="${v}"${sel}>${label}</option>`;
  }).join("");
}
const TRANSITIONS = ["cut", "fade", "dip-to-black", "wipe-left", "wipe-right", "push-up"];
function transitionOptions(current?: string): string {
  return TRANSITIONS.map((t) => {
    const sel = (current ?? "cut") === t ? " selected" : "";
    return `<option value="${t}"${sel}>${t}</option>`;
  }).join("");
}
const MOTION_KINDS = ["still", "kenburns", "dolly", "pan"];
function motionKindOptions(current?: string): string {
  return MOTION_KINDS.map((k) => {
    const sel = (current ?? "still") === k ? " selected" : "";
    return `<option value="${k}"${sel}>${k}</option>`;
  }).join("");
}
const MOTION_DIRS = ["", "in", "out", "left", "right", "up", "down"];
function motionDirOptions(current?: string): string {
  return MOTION_DIRS.map((d) => {
    const sel = (current ?? "") === d ? " selected" : "";
    return `<option value="${d}"${sel}>${d || "(no direction)"}</option>`;
  }).join("");
}
const MOTION_INTENSITIES = ["subtle", "medium", "strong"];
function motionIntensityOptions(current?: string): string {
  return MOTION_INTENSITIES.map((i) => {
    const sel = (current ?? "subtle") === i ? " selected" : "";
    return `<option value="${i}"${sel}>${i}</option>`;
  }).join("");
}
const FOCUS_KINDS = ["", "vignette", "spotlight", "dof"];
function focusKindOptions(current?: string): string {
  return FOCUS_KINDS.map((k) => {
    const sel = (current ?? "") === k ? " selected" : "";
    return `<option value="${k}"${sel}>${k || "(none)"}</option>`;
  }).join("");
}

function tierColor(t: string | undefined): string {
  if (t === "S") return "#3ddc7e";
  if (t === "A") return "#f4c84a";
  if (t === "B") return "#d97b5f";
  return "#666";
}

export function buildStoryboardHtml(
  sb: Storyboard,
  catalogPath: string
): string {
  const cat = loadCatalog(catalogPath);

  // Per-scene rendered mp4 paths (if render has run). Relative to output/.
  const sceneVideos = new Map<number, string>();
  for (const sc of sb.scenes) {
    if (sc.renderedPath) {
      const rel = sc.renderedPath.replace(/^output\//, "");
      sceneVideos.set(sc.index, rel);
    }
  }
  const hasFinal = sb.stages.rendered;

  const sceneCards = sb.scenes
    .map((sc) => {
      const m = sc.method ? cat.get(sc.method) : null;
      const fb = sc.fallback ? cat.get(sc.fallback) : null;
      const mTier = m?.reliability ?? "?";
      const mEngine = m?.engine ?? "?";
      const mLabel = m?.label ?? "<em style='color:#888'>未选择</em>";

      const assetList = sc.assets.length
        ? sc.assets.map((a) => `<span class="chip">${esc(a)}</span>`).join("")
        : `<span class="muted">无</span>`;

      const noteList = sc.notes.length
        ? `<ul class="notes">${sc.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
        : "";

      const fallbackBlock = sc.fallback
        ? `<div class="row"><span class="lbl">备选</span><span class="val">${esc(fb?.label ?? sc.fallback)} <span class="tier" style="background:${tierColor(fb?.reliability)}">${fb?.reliability ?? "?"}</span></span></div>`
        : `<div class="row"><span class="lbl">备选</span><span class="val muted">无</span></div>`;

      // Motion + focus + transition + voice chips
      const motion = sc.motion;
      const motionChip = motion && motion.kind !== "still"
        ? `<span class="fx-chip motion">${esc(motion.kind)}${motion.direction ? " " + esc(motion.direction) : ""} · ${esc(motion.intensity ?? "subtle")} · <code>${esc(motion.ease ?? "power3.inOut")}</code></span>`
        : motion?.kind === "still"
          ? `<span class="fx-chip muted">still</span>`
          : `<span class="fx-chip muted">—</span>`;
      const focus = sc.focus;
      const focusChip = focus
        ? `<span class="fx-chip focus">${esc(focus.kind)}${focus.dim != null ? " dim " + focus.dim : ""}</span>`
        : `<span class="fx-chip muted">—</span>`;
      const tr = sc.transition ?? "cut";
      const trChip = tr === "cut"
        ? `<span class="fx-chip muted">cut</span>`
        : `<span class="fx-chip trans">${esc(tr)}${sc.transitionDur ? " " + sc.transitionDur + "s" : ""}</span>`;
      const voiceChip = sc.voice
        ? `<span class="fx-chip voice">${esc(sc.voice)}</span>`
        : "";
      const burnChip = sc.burnSubtitle
        ? `<span class="fx-chip burn">burn caption</span>`
        : "";
      const fgChip = sc.foreground
        ? `<span class="fx-chip fg">fg: ${esc(path.basename(sc.foreground))}</span>`
        : "";
      const effectsRow = `
  <div class="row"><span class="lbl">效果</span><span class="val fx">
    <span class="fx-label">motion</span>${motionChip}
    <span class="fx-label">focus</span>${focusChip}
    <span class="fx-label">transition</span>${trChip}
    ${voiceChip}${burnChip}${fgChip}
  </span></div>`;

      const reasoningBlock = sc.reasoning
        ? `<div class="reasoning">${esc(sc.reasoning)}</div>`
        : `<div class="reasoning muted">（待 Claude 填写）</div>`;

      const videoPath = sceneVideos.get(sc.index);
      const videoBlock = videoPath
        ? `<video class="scene-video" preload="metadata" muted playsinline data-start="${sc.startSec.toFixed(2)}" data-scene="${sc.index}">
       <source src="${esc(videoPath)}" type="video/mp4" />
     </video>`
        : `<div class="scene-video-placeholder">未渲染 — 运行 <code>pipeline render</code></div>`;

      // Last-change marker — if this scene was touched in the latest history entry
      const lastEntry = (sb.history ?? []).at(-1);
      const lastTouchedHere = lastEntry?.diffs?.[sc.index];
      const lastBadge = lastTouchedHere
        ? `<span class="last-change-badge" title="last change by ${esc(lastEntry!.source)}: ${esc(lastEntry!.label)}">edited</span>`
        : "";

      return `
<article class="scene" id="scene-${sc.index}">
  <div class="scene-main">
    <header>
      <div class="idx">SCENE ${String(sc.index).padStart(2, "0")} ${lastBadge}</div>
      <div class="timing">${formatTime(sc.startSec)} → ${formatTime(sc.endSec)} <span class="dur">(${sc.durationSec.toFixed(2)}s)</span></div>
      <div class="status">${esc(sc.status ?? "pending")}</div>
      <button class="edit-toggle" data-scene-edit="${sc.index}" type="button">✎ edit</button>
    </header>

    <blockquote class="caption">${esc(sc.text)}</blockquote>

    <div class="grid view-mode">
      <div class="row"><span class="lbl">主选方法</span><span class="val">${mLabel} <span class="tier" style="background:${tierColor(m?.reliability)}">${mTier}</span> <span class="engine">${esc(mEngine)}</span></span></div>
      ${fallbackBlock}
      ${effectsRow}
      <div class="row"><span class="lbl">素材</span><span class="val">${assetList}</span></div>
    </div>

    <div class="grid edit-mode" data-scene-form="${sc.index}" hidden>
      <div class="row"><span class="lbl">方法</span><span class="val">
        <select data-field="method">${methodOptions(cat, sc.method)}</select>
      </span></div>
      <div class="row"><span class="lbl">备选</span><span class="val">
        <select data-field="fallback">${methodOptions(cat, sc.fallback, true)}</select>
      </span></div>
      <div class="row"><span class="lbl">音色</span><span class="val">
        <select data-field="voice">${voiceOptions(sc.voice)}</select>
      </span></div>
      <div class="row"><span class="lbl">过渡</span><span class="val">
        <select data-field="transition">${transitionOptions(sc.transition)}</select>
      </span></div>
      <div class="row"><span class="lbl">动效</span><span class="val">
        <select data-field="motion.kind">${motionKindOptions(sc.motion?.kind)}</select>
        <select data-field="motion.direction">${motionDirOptions(sc.motion?.direction)}</select>
        <select data-field="motion.intensity">${motionIntensityOptions(sc.motion?.intensity)}</select>
      </span></div>
      <div class="row"><span class="lbl">焦点</span><span class="val">
        <select data-field="focus.kind">${focusKindOptions(sc.focus?.kind)}</select>
      </span></div>
      <div class="row"><span class="lbl">烧字幕</span><span class="val">
        <label><input type="checkbox" data-field="burnSubtitle"${sc.burnSubtitle ? " checked" : ""} /> burn cue text on video</label>
      </span></div>
      <div class="row"><span class="lbl">理由</span><span class="val">
        <textarea data-field="reasoning" rows="2" placeholder="why this method">${esc(sc.reasoning ?? "")}</textarea>
      </span></div>
      <div class="row edit-actions">
        <button class="btn-save" data-scene-save="${sc.index}" type="button">apply to this scene</button>
        <button class="btn-cancel" data-scene-cancel="${sc.index}" type="button">cancel</button>
      </div>
    </div>

    ${reasoningBlock}
    ${noteList}
  </div>
  <aside class="scene-preview" role="button" data-scene-jump="${sc.index}" title="点击在主片预览中跳转到此场景">
    ${videoBlock}
  </aside>
</article>`.trim();
    })
    .join("\n\n");

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>${esc(sb.project.title)} · Storyboard</title>
<style>
  :root {
    --bg: #0a0612;
    --bg2: #110a1f;
    --fg: #f4ead0;
    --muted: rgba(244,234,208,0.45);
    --gold: #d4a64a;
    --gold-bright: #f4d479;
    --border: rgba(212,166,74,0.25);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 40px 80px;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Source Han Sans SC", "Microsoft Yahei", sans-serif;
    line-height: 1.55;
    min-height: 100vh;
  }
  h1 { font-size: 36px; letter-spacing: 0.04em; margin: 0 0 8px; }
  .meta { color: var(--muted); font-size: 14px; letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 36px; }
  .pool {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 36px;
    font-size: 13px;
  }
  .pool .lbl { color: var(--gold); letter-spacing: 0.18em; text-transform: uppercase; margin-right: 12px; }
  .chip {
    display: inline-block;
    padding: 3px 10px;
    margin: 3px 6px 3px 0;
    background: rgba(212,166,74,0.08);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    color: var(--gold-bright);
  }
  .muted { color: var(--muted); }
  article.scene {
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 24px;
    background: rgba(255,255,255,0.025);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px 28px;
    margin-bottom: 18px;
    align-items: start;
  }
  article.scene .scene-main { min-width: 0; }
  article.scene .scene-preview {
    position: sticky; top: 16px;
    cursor: pointer;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #000;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }
  article.scene .scene-preview:hover { transform: translateY(-2px); border-color: var(--gold); box-shadow: 0 16px 36px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,166,74,0.35); }
  article.scene .scene-preview video { display: block; width: 100%; height: auto; aspect-ratio: 16/9; background: #000; }
  article.scene .scene-video-placeholder { display: flex; align-items: center; justify-content: center; aspect-ratio: 16/9; padding: 14px; text-align: center; color: var(--muted); font-size: 12px; line-height: 1.5; }
  article.scene .scene-video-placeholder code { color: var(--gold-bright); }
  @media (max-width: 1100px) {
    article.scene { grid-template-columns: 1fr; }
    article.scene .scene-preview { position: relative; top: 0; max-width: 480px; }
  }
  .player-bar { position: sticky; top: 0; z-index: 10; padding: 12px 20px; margin: -48px -40px 24px; background: rgba(10,6,18,0.92); border-bottom: 1px solid var(--border); backdrop-filter: blur(8px); display: ${hasFinal ? "block" : "none"}; }
  .player-bar video { width: 100%; max-height: 360px; background: #000; border-radius: 6px; }
  .player-bar .hint { font-size: 12px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; margin-top: 6px; }

  .approval-bar { padding: 14px 20px; margin: 0 0 24px; border-radius: 10px; border: 1px solid var(--border); font-size: 14px; }
  .approval-bar.approved     { background: rgba(122, 235, 184, 0.08); border-color: rgba(122, 235, 184, 0.4); color: #b6f0d3; }
  .approval-bar.needs-approve { background: rgba(255, 196, 122, 0.07); border-color: rgba(255, 196, 122, 0.4); color: #ffd49c; }
  .approval-bar.no-analyze   { background: rgba(244, 234, 208, 0.04); color: var(--muted); }
  .approval-bar .state-icon  { font-weight: 700; margin-right: 8px; }
  .approval-bar code { background: rgba(0,0,0,0.4); padding: 1px 6px; border-radius: 3px; font-size: 12px; color: var(--gold-bright); }

  .edit-toggle { background: transparent; border: 1px solid rgba(244,234,208,0.2); color: var(--muted); border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 11px; letter-spacing: 0.1em; margin-left: 12px; }
  .edit-toggle:hover { color: var(--gold); border-color: var(--gold); }
  article.scene.editing .edit-toggle { color: var(--gold); border-color: var(--gold); }

  .grid.edit-mode { display: none; }
  article.scene.editing .grid.view-mode { display: none; }
  article.scene.editing .grid.edit-mode { display: grid; }
  .grid.edit-mode select, .grid.edit-mode textarea, .grid.edit-mode input[type=checkbox] {
    background: rgba(0,0,0,0.4); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-family: inherit; font-size: 13px;
  }
  .grid.edit-mode select { min-width: 180px; margin-right: 8px; }
  .grid.edit-mode textarea { width: 100%; resize: vertical; font-size: 13px; }
  .grid.edit-mode .edit-actions { margin-top: 8px; }
  .grid.edit-mode .btn-save { background: var(--gold); color: #1a1106; padding: 6px 14px; border: 0; border-radius: 4px; cursor: pointer; font-weight: 600; margin-right: 8px; }
  .grid.edit-mode .btn-cancel { background: transparent; color: var(--muted); border: 1px solid var(--border); padding: 6px 14px; border-radius: 4px; cursor: pointer; }

  .last-change-badge { background: rgba(255, 196, 122, 0.18); color: #ffd49c; padding: 1px 8px; border-radius: 10px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; margin-left: 8px; vertical-align: middle; }

  .dl-banner { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--gold); color: #1a1106; padding: 14px 22px; border-radius: 10px; font-size: 14px; font-weight: 600; box-shadow: 0 24px 60px rgba(0,0,0,0.6); z-index: 100; display: none; align-items: center; gap: 16px; }
  .dl-banner.show { display: flex; }
  .dl-banner a { color: #1a1106; background: rgba(255,255,255,0.45); padding: 6px 12px; border-radius: 4px; text-decoration: none; font-weight: 600; }
  article.scene header {
    display: flex;
    align-items: baseline;
    gap: 24px;
    padding-bottom: 14px;
    border-bottom: 1px dashed rgba(212,166,74,0.15);
    margin-bottom: 16px;
  }
  .idx { font-weight: 600; letter-spacing: 0.2em; color: var(--gold); font-size: 14px; }
  .timing { font-family: ui-monospace, Menlo, monospace; font-size: 13px; color: var(--muted); }
  .timing .dur { color: var(--gold-bright); margin-left: 8px; }
  .status { margin-left: auto; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
  .caption { font-size: 22px; line-height: 1.4; margin: 0 0 16px; padding-left: 16px; border-left: 3px solid var(--gold); }
  .grid { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 12px; }
  .row { display: flex; gap: 14px; font-size: 14px; }
  .row .lbl { width: 96px; flex-shrink: 0; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; font-size: 11px; padding-top: 2px; }
  .row .val { flex: 1; }
  .tier { display: inline-block; min-width: 18px; text-align: center; padding: 1px 6px; border-radius: 3px; color: #000; font-size: 11px; font-weight: 600; margin: 0 6px; }
  .engine { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--muted); margin-left: 8px; padding: 1px 6px; border: 1px solid var(--border); border-radius: 3px; }
  .reasoning { font-size: 13px; color: rgba(244,234,208,0.7); padding: 10px 12px; background: rgba(0,0,0,0.2); border-radius: 6px; margin-top: 8px; border-left: 2px solid var(--gold); }
  .notes { font-size: 13px; color: var(--gold-bright); margin: 12px 0 0 18px; padding: 0; }
  .notes li { margin-bottom: 4px; }
  .row .val.fx { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
  .fx-label { color: rgba(244,234,208,0.32); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; margin-right: 2px; }
  .fx-chip {
    display: inline-block;
    padding: 3px 9px;
    font-size: 11px;
    border-radius: 999px;
    border: 1px solid rgba(212,166,74,0.3);
    background: rgba(212,166,74,0.06);
    color: var(--fg);
    letter-spacing: 0.04em;
  }
  .fx-chip code { font-family: ui-monospace,Menlo,monospace; font-size: 10px; color: var(--gold-bright); margin-left: 2px; }
  .fx-chip.motion { border-color: rgba(159, 217, 255, 0.45); color: #b3def9; }
  .fx-chip.focus  { border-color: rgba(255, 196, 122, 0.5); color: #ffd49c; }
  .fx-chip.trans  { border-color: rgba(192, 161, 255, 0.5); color: #d2bfff; }
  .fx-chip.voice  { border-color: rgba(122, 235, 184, 0.5); color: #9bf2c8; }
  .fx-chip.burn   { border-color: rgba(255, 159, 122, 0.55); color: #ffb89c; }
  .fx-chip.fg     { border-color: rgba(244, 212, 121, 0.6); color: var(--gold-bright); }
  .fx-chip.muted  { border-color: rgba(244,234,208,0.18); color: rgba(244,234,208,0.4); background: transparent; }
</style>
</head>
<body>
  ${hasFinal ? `<div class="player-bar"><video id="main-player" controls preload="metadata"><source src="final.mp4" type="video/mp4" /></video><div class="hint">click any scene preview ↓ to seek main player to that scene</div></div>` : ""}
  <div class="approval-bar ${sb.stages.approved ? "approved" : sb.stages.analyzed ? "needs-approve" : "no-analyze"}">
    ${
      sb.stages.approved
        ? `<span class="state-icon">✓</span> Storyboard <b>approved</b> — ready to render.`
        : sb.stages.analyzed
          ? `<span class="state-icon">⚠</span> Reviewed but <b>not approved</b>. Edit inline below or run <code>pipeline edit "..."</code>. When happy, run <code>pipeline approve</code>.`
          : `<span class="state-icon">⏸</span> Not yet analyzed. Run <code>pipeline analyze</code> first.`
    }
  </div>
  <h1>${esc(sb.project.title)}</h1>
  <div class="meta">
    SOURCE · ${esc(sb.source)} &nbsp;·&nbsp;
    ${sb.scenes.length} scenes &nbsp;·&nbsp;
    ${formatTime(sb.scenes.at(-1)?.endSec ?? 0)} total &nbsp;·&nbsp;
    ${sb.project.width}×${sb.project.height}@${sb.project.fps}fps
  </div>

  <div class="pool">
    <span class="lbl">Asset pool (${sb.assetPool.length})</span>
    ${sb.assetPool.length ? sb.assetPool.map((a) => `<span class="chip">${esc(a)}</span>`).join("") : `<span class="muted">空目录 — 放在 assets/ 下的文件会出现在这里</span>`}
  </div>

  ${sceneCards}

  <div style="margin-top:48px;text-align:center;color:var(--muted);font-size:12px;letter-spacing:0.2em;">
    Generated ${esc(sb.createdAt)}
  </div>

  <script>
    (function() {
      // Click a scene preview → seek the main player + scroll to top.
      const player = document.getElementById("main-player");
      if (!player) return;
      // Use perceived start times (xfade-adjusted) for accurate seeking.
      const sceneStarts = ${JSON.stringify(
        Object.fromEntries(
          (() => {
            const out = new Map<number, number>();
            let cursor = 0;
            for (let i = 0; i < sb.scenes.length; i++) {
              const sc = sb.scenes[i];
              const tr = i === 0 ? "cut" : (sc.transition ?? "cut");
              const tDur = sc.transitionDur ?? (tr === "dip-to-black" ? 0.6 : 0.4);
              const start = i === 0 ? 0 : cursor - (tr === "cut" ? 0 : tDur);
              out.set(sc.index, +start.toFixed(2));
              cursor = start + sc.durationSec;
            }
            return out;
          })()
        )
      )};
      document.querySelectorAll("[data-scene-jump]").forEach((el) => {
        el.addEventListener("click", () => {
          const idx = el.getAttribute("data-scene-jump");
          const t = sceneStarts[idx];
          if (t == null) return;
          player.currentTime = Math.max(0, t);
          player.play().catch(() => {});
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      });
      // Hover a preview → poster + auto-play loop muted
      document.querySelectorAll(".scene-video").forEach((v) => {
        v.addEventListener("mouseenter", () => { v.play().catch(()=>{}); });
        v.addEventListener("mouseleave", () => { v.pause(); v.currentTime = 0; });
      });

      // ─── Inline editor ────────────────────────────────────────────
      // We collect per-scene edits in memory. When the user clicks 'apply',
      // we produce a downloadable storyboard.json (the original with our
      // patches merged in) for them to replace output/storyboard.json with.
      const sourceStoryboard = ${JSON.stringify(sb)};
      const pendingEdits = {};  // sceneIndex → partial patch

      function readForm(sceneIdx) {
        const form = document.querySelector('[data-scene-form="' + sceneIdx + '"]');
        if (!form) return null;
        const out = {};
        form.querySelectorAll('[data-field]').forEach((el) => {
          const f = el.getAttribute('data-field');
          const v = el.type === "checkbox" ? el.checked : el.value;
          // nested: motion.kind, motion.direction, focus.kind, etc.
          if (f.includes('.')) {
            const [a, b] = f.split('.');
            out[a] = out[a] || {};
            if (v !== "" && v != null) out[a][b] = v;
          } else if (v === "") {
            out[f] = null;
          } else {
            out[f] = v;
          }
        });
        // Normalize: empty focus.kind → focus: null
        if (out.focus && !out.focus.kind) out.focus = null;
        // motion: ensure kind is set even if defaulted to "still"
        if (!out.motion) out.motion = { kind: "still" };
        return out;
      }

      document.querySelectorAll('[data-scene-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = btn.getAttribute('data-scene-edit');
          const card = document.getElementById('scene-' + idx);
          card.classList.toggle('editing');
        });
      });
      document.querySelectorAll('[data-scene-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = btn.getAttribute('data-scene-cancel');
          document.getElementById('scene-' + idx).classList.remove('editing');
        });
      });
      document.querySelectorAll('[data-scene-save]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-scene-save');
          const patch = readForm(idx);
          if (!patch) return;
          pendingEdits[idx] = patch;
          document.getElementById('scene-' + idx).classList.remove('editing');
          updateBanner();
        });
      });

      // Floating banner — appears whenever there are pending edits
      const banner = document.createElement('div');
      banner.className = 'dl-banner';
      banner.innerHTML = '<span id="banner-text">0 scene change(s) staged</span><a id="banner-dl" download="storyboard.json">Download patched JSON</a>';
      document.body.appendChild(banner);

      function updateBanner() {
        const ids = Object.keys(pendingEdits);
        if (!ids.length) { banner.classList.remove('show'); return; }
        banner.classList.add('show');
        document.getElementById('banner-text').textContent = ids.length + ' scene change(s) staged. Download → overwrite output/storyboard.json → run \`pipeline approve\` → render.';

        // Build a patched storyboard JSON for download
        const patched = JSON.parse(JSON.stringify(sourceStoryboard));
        for (const sc of patched.scenes) {
          const p = pendingEdits[sc.index];
          if (!p) continue;
          // Apply only fields present in patch (avoid wiping unrelated fields)
          for (const [k, v] of Object.entries(p)) {
            sc[k] = v;
          }
          // The edit invalidates this scene's render cache.
          delete sc.renderedHash;
        }
        // Mark as no longer approved — user must re-approve after applying.
        patched.stages = { ...(patched.stages ?? {}), approved: false };
        patched.history = [
          ...(patched.history ?? []),
          {
            at: new Date().toISOString(),
            source: "user-inline",
            label: ids.length + " scene inline edit",
            diffs: Object.fromEntries(
              ids.map((i) => {
                const before = sourceStoryboard.scenes.find((s) => s.index == i);
                const fields = pendingEdits[i];
                return [i, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { from: before?.[k] ?? null, to: v }]))];
              })
            ),
          },
        ];
        const blob = new Blob([JSON.stringify(patched, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const dl = document.getElementById('banner-dl');
        if (dl.dataset.prevUrl) URL.revokeObjectURL(dl.dataset.prevUrl);
        dl.href = url;
        dl.dataset.prevUrl = url;
      }
    })();
  </script>
</body>
</html>`;
}

export function writeStoryboardHtml(
  storyboardJsonPath: string,
  catalogPath: string,
  outHtmlPath: string
): void {
  const sb: Storyboard = JSON.parse(fs.readFileSync(storyboardJsonPath, "utf8"));
  const html = buildStoryboardHtml(sb, catalogPath);
  fs.mkdirSync(path.dirname(outHtmlPath), { recursive: true });
  fs.writeFileSync(outHtmlPath, html);
}
