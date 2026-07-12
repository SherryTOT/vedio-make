const $ = (s) => document.querySelector(s);
const TOKEN = window.__PIPELINE_TOKEN__ || new URLSearchParams(location.search).get("token") || "";
const AUTH = TOKEN ? { Authorization: "Bearer " + TOKEN } : {};

// transition ids the renderer understands ("" = 默认 cut)
const TRANSITIONS = ["", "cut", "fade", "dip-to-black", "wipe-left", "wipe-right", "push-up"];
const state = { pid: null, sb: null, catalog: null, designs: null, lint: null, saveTimer: null, busy: false, dirty: false, curTask: null, lastTask: null, sel: 0 };

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...AUTH, ...(opts.headers || {}) } });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}
function fileUrl(rel) { return `/api/projects/${state.pid}/files/${rel.split("/").map(encodeURIComponent).join("/")}${TOKEN ? "?token=" + encodeURIComponent(TOKEN) : ""}`; }
function fmt(sec) { sec = Math.max(0, Math.round(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; }
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
let toastT;
function toast(msg, type) { const t = $("#toast"); t.textContent = msg; t.dataset.type = type || ""; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

// ─── theme ───
document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("vm-theme", next); } catch {}
}));

// ─── views ───
function showProjects() { $("#projects-view").hidden = false; $("#board-view").hidden = true; $("#home-actions").hidden = false; $("#board-actions").hidden = true; state.pid = null; state.sb = null; loadProjects(); }
function showBoard() { $("#projects-view").hidden = true; $("#board-view").hidden = false; $("#home-actions").hidden = true; $("#board-actions").hidden = false; }

async function loadProjects() {
  const grid = $("#projects-grid");
  grid.innerHTML = "";
  let projects = [];
  try { ({ projects } = await api("/api/projects")); } catch (e) { return toast("加载项目失败:" + e.message, "error"); }
  $("#project-count").textContent = `${projects.length} 个项目`;
  if (!projects.length) { grid.appendChild(el("div", "empty-hint", "还没有项目。点右上「新建项目」,粘贴一段 SRT 字幕即可切出分镜。")); return; }
  const details = await Promise.all(projects.map((p) => api(`/api/projects/${p.id}`).catch(() => null)));
  projects.forEach((p, i) => {
    const d = details[i];
    const sb = d && d.storyboard;
    const scenes = sb ? sb.scenes.length : 0;
    const dur = sb ? sb.scenes.reduce((s, x) => s + (x.durationSec || 0), 0) : 0;
    const stages = sb ? sb.stages : null;
    const card = el("button", "pcard");
    card.type = "button";
    card.appendChild(el("div", "cover", sb ? `▦ ${scenes}` : "—"));
    const body = el("div", "pc-body");
    body.appendChild(el("div", "pc-title", esc(p.title || "未命名")));
    body.appendChild(el("div", "pc-meta", sb ? `${scenes} 镜头 · ${fmt(dur)}` : "无 storyboard"));
    if (stages) { const st = el("div", "pc-stages"); for (const k of ["parsed", "analyzed", "approved", "rendered"]) st.appendChild(el("span", "stage" + (stages[k] ? " on" : ""), stageLabel(k))); body.appendChild(st); }
    card.appendChild(body);
    card.addEventListener("click", () => openProject(p.id));
    grid.appendChild(card);
  });
}
function stageLabel(k) { return { parsed: "切分", analyzed: "分析", approved: "确认", rendered: "渲染" }[k] || k; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ─── open a project ───
async function openProject(id) {
  state.pid = id;
  let detail;
  try { detail = await api(`/api/projects/${id}`); }
  catch (e) { toast("打开失败:" + e.message, "error"); showProjects(); return; }
  state.sb = detail.storyboard;
  state.catalog = await loadCatalog(id);
  state.designs = await api("/api/designs").catch(() => null);
  state.sel = 0;
  showBoard();
  renderBoardHeader(detail.project);
  renderScenes();
}
async function loadCatalog(id) {
  try {
    const raw = await api(`/api/projects/${id}/files/methods/catalog.json`);
    const arr = Array.isArray(raw) ? raw : (raw.methods || []);
    const map = new Map();
    for (const m of arr) if (m && m.id) map.set(m.id, m);
    return map.size ? map : null;
  } catch { return null; }
}
function renderBoardHeader(project) {
  const sb = state.sb;
  $("#board-title").textContent = (sb && sb.project && sb.project.title) || (project && project.title) || "项目";
  if (sb && sb.project) $("#board-dims").textContent = `${sb.project.width}×${sb.project.height} @${sb.project.fps}`;
  const dur = sb ? sb.scenes.reduce((s, x) => s + (x.durationSec || 0), 0) : 0;
  $("#board-duration").textContent = fmt(dur);
  const wrap = $("#board-stages"); wrap.innerHTML = "";
  if (sb && sb.stages) for (const k of ["parsed", "analyzed", "approved", "rendered"]) wrap.appendChild(el("span", "stage" + (sb.stages[k] ? " on" : ""), stageLabel(k)));
  updateHint();
}

// ─── master-detail board ───
// renderScenes() keeps its historical name: every task/lint/save path calls it.
// It now paints the strip (master list) + the detail editor for state.sel.
function renderScenes() {
  clampSel();
  renderStrip();
  renderDetail();
}
function clampSel() {
  const n = state.sb ? state.sb.scenes.length : 0;
  if (state.sel >= n) state.sel = n - 1;
  if (state.sel < 0) state.sel = 0;
}
function selScene() { return state.sb && state.sb.scenes[state.sel]; }

function methodShort(id) { return id ? id.replace(/^(hf|rm)-/, "") : "未选"; }

function renderStrip() {
  const strip = $("#strip");
  strip.innerHTML = "";
  if (!state.sb || !state.sb.scenes.length) {
    strip.appendChild(el("div", "strip-empty", "这个项目还没有分镜。先「分析」或加一个镜头。"));
    return;
  }
  state.sb.scenes.forEach((sc, i) => {
    const item = el("button", "strip-item");
    item.type = "button";
    item.setAttribute("role", "option");
    if (i === state.sel) { item.classList.add("sel"); item.setAttribute("aria-current", "true"); }
    const status = sc.status || (sc.renderedPath ? "rendered" : "pending");

    const thumb = el("div", "si-thumb");
    if (sc.renderedPath) {
      const v = el("video"); v.src = fileUrl(sc.renderedPath); v.muted = true; v.preload = "metadata"; v.playsInline = true;
      thumb.appendChild(v);
    } else {
      const img = sc.assets && sc.assets.find((a) => /\.(png|jpe?g|webp|gif)$/i.test(a));
      if (img) { const im = el("img"); im.loading = "lazy"; im.src = fileUrl(img.startsWith("assets/") ? img : "assets/" + img); thumb.appendChild(im); }
      else thumb.appendChild(el("span", "si-noimg", "—"));
    }

    const main = el("div", "si-main");
    const top = el("div", "si-top");
    top.appendChild(el("span", "si-n", "#" + (sc.index ?? i + 1)));
    top.appendChild(el("span", "si-text", esc((sc.text || "(空白字幕)").split("\n")[0])));
    main.appendChild(top);
    const meta = el("div", "si-meta");
    meta.appendChild(el("span", "si-method", esc(methodShort(sc.method))));
    meta.appendChild(el("span", "si-dur", (sc.durationSec || 0).toFixed(1) + "s"));
    const st = el("span", "st"); st.dataset.s = status; st.title = stStatusText(status);
    meta.appendChild(st);
    const lf = state.lint && state.lint[sc.index];
    if (lf && lf.length) { const w = el("span", "si-warn", "⚠"); w.title = lf.map((f) => f.msg).join("\n"); meta.appendChild(w); }
    main.appendChild(meta);

    item.append(thumb, main);
    item.addEventListener("click", () => selectScene(i));
    strip.appendChild(item);
  });
}

function selectScene(i) {
  state.sel = i;
  renderStrip();
  renderDetail();
  const it = $("#strip").children[i];
  if (it && it.scrollIntoView) it.scrollIntoView({ block: "nearest" });
}

// Update just the strip row for the selected scene while typing (no full repaint,
// so the textarea keeps focus).
function syncStripRow() {
  const sc = selScene(); if (!sc) return;
  const item = $("#strip").children[state.sel]; if (!item) return;
  const t = item.querySelector(".si-text"); if (t) t.textContent = (sc.text || "(空白字幕)").split("\n")[0];
  const m = item.querySelector(".si-method"); if (m) m.textContent = methodShort(sc.method);
}

function renderDetail() {
  const pane = $("#detail");
  pane.innerHTML = "";
  const sc = selScene();
  if (!sc) { pane.appendChild(el("div", "d-empty", "左侧选一个镜头,或「＋ 加一个镜头」。")); return; }
  const i = state.sel;
  const status = sc.status || (sc.renderedPath ? "rendered" : "pending");

  // ── preview + actions ──
  const head = el("div", "d-head");
  const pv = el("div", "d-preview");
  if (sc.renderedPath) {
    const v = el("video"); v.src = fileUrl(sc.renderedPath); v.muted = true; v.loop = true; v.playsInline = true; v.controls = false;
    v.addEventListener("mouseenter", () => v.play().catch(() => {}));
    v.addEventListener("mouseleave", () => v.pause());
    v.addEventListener("click", () => lightbox("video", v.src));
    pv.appendChild(v);
  } else {
    const img = sc.assets && sc.assets.find((a) => /\.(png|jpe?g|webp|gif)$/i.test(a));
    if (img) { const im = el("img"); im.src = fileUrl(img.startsWith("assets/") ? img : "assets/" + img); im.addEventListener("click", () => lightbox("img", im.src)); pv.appendChild(im); }
    else pv.appendChild(el("div", "pv-empty", "未渲染 — 右侧「渲染此镜」看效果"));
  }
  head.appendChild(pv);

  const side = el("div", "d-side");
  const stRow = el("div", "d-strow");
  const stEl = el("span", "st", stStatusText(status)); stEl.dataset.s = status;
  stRow.appendChild(stEl);
  stRow.appendChild(el("span", "d-time", `${fmt(sc.startSec)}–${fmt(sc.endSec)} · ${(sc.durationSec || 0).toFixed(1)}s`));
  side.appendChild(stRow);
  const rBtn = el("button", "primary d-render", "渲染此镜"); rBtn.type = "button";
  rBtn.addEventListener("click", () => runOp("render", { only: sc.index }, `渲染镜头 #${sc.index}`));
  side.appendChild(rBtn);
  const ops = el("div", "d-ops");
  const opBtn = (txt, title, fn, danger) => { const b = el("button", "rc" + (danger ? " rc-del" : ""), txt); b.type = "button"; b.title = title; b.addEventListener("click", fn); return b; };
  ops.append(
    opBtn("↑ 上移", "上移", () => moveScene(i, -1)),
    opBtn("↓ 下移", "下移", () => moveScene(i, 1)),
    opBtn("✕ 删除", "删除镜头", () => { if (confirm(`删除镜头 #${sc.index}?`)) deleteScene(i); }, true),
  );
  side.appendChild(ops);
  side.appendChild(el("div", "d-keys", "快捷键:↑↓ 切镜 · Enter 改字幕 · R 渲染此镜"));
  head.appendChild(side);
  pane.appendChild(head);

  // ── fields ──
  const form = el("div", "d-form");

  form.appendChild(dField("字幕文本", dTextarea("text", sc.text || "", "这一镜的解说词/字幕", 2, () => syncStripRow())));

  const mRow = el("div", "d-row2");
  mRow.appendChild(dField("方法", methodControl("method", sc.method)));
  mRow.appendChild(dField("备选(需 S 档)", methodControl("fallback", sc.fallback)));
  form.appendChild(mRow);

  form.appendChild(dField("选法理由", dTextarea("reasoning", sc.reasoning || "", "为什么这一镜用这个方法(分析器会写,人可改)", 2)));

  const xRow = el("div", "d-row2");
  xRow.appendChild(dField("转场(入)", transitionSelect(i, sc.transition)));
  if (state.designs) xRow.appendChild(dField("风格", scenePresetSelect(i, sc.style)));
  form.appendChild(xRow);

  const badges = el("div", "chips");
  if (sc.assets && sc.assets.length) sc.assets.forEach((a) => badges.appendChild(el("span", "chip asset", esc(a.split("/").pop()))));
  if (sc.motion && sc.motion.kind && sc.motion.kind !== "still") badges.appendChild(el("span", "chip", "运镜·" + esc(sc.motion.kind)));
  if (sc.imageStyle) badges.appendChild(el("span", "chip", esc(sc.imageStyle)));
  if (sc.needsMatting) badges.appendChild(el("span", "chip", "抠像"));
  if (sc.burnSubtitle) badges.appendChild(el("span", "chip", "烧字幕"));
  if (sc.style) badges.appendChild(el("span", "chip", "风格·" + esc(sc.style.presetId || "自定义")));
  const lf = state.lint && state.lint[sc.index];
  if (lf && lf.length) { const c = el("span", "chip chip-warn", "⚠ 土味 " + lf.length); c.title = lf.map((f) => f.msg).join("\n"); badges.appendChild(c); }
  if (badges.children.length) form.appendChild(dField("资源 / 修饰", badges));

  form.appendChild(dField("备注(每行一条)", dTextarea("notes", (sc.notes || []).join("\n"), "给渲染/后期的备注", 2)));

  pane.appendChild(form);
}

function dField(label, node) { const w = el("div", "d-field"); w.appendChild(el("div", "field-label", label)); w.appendChild(node); return w; }

function autosize(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 260) + "px"; }
function dTextarea(field, value, ph, rows, onInput) {
  const ta = el("textarea", "d-ta"); ta.dataset.field = field; ta.value = value; ta.placeholder = ph || ""; ta.rows = rows || 2;
  ta.addEventListener("input", () => { applyField(field, ta.value); autosize(ta); if (onInput) onInput(); scheduleSave(); });
  requestAnimationFrame(() => autosize(ta));
  return ta;
}
function applyField(field, value) {
  const sc = selScene(); if (!sc) return;
  if (field === "notes") sc.notes = value.split("\n").map((s) => s.trim()).filter(Boolean);
  else if (field === "reasoning") sc.reasoning = value || null;
  else sc[field] = value;
}

function methodControl(field, value) {
  let ctrl;
  if (state.catalog) {
    ctrl = el("select", "vm-input");
    ctrl.appendChild(new Option("— 无 —", ""));
    let has = false;
    for (const [id, m] of state.catalog) { const o = new Option(`${id} · ${m.label || ""} [${m.engine}/${m.reliability}]`, id); if (id === value) { o.selected = true; has = true; } ctrl.appendChild(o); }
    if (value && !has) { const o = new Option(value + " (未在 catalog)", value); o.selected = true; ctrl.appendChild(o); }
  } else {
    ctrl = el("input", "vm-input"); ctrl.value = value || ""; ctrl.placeholder = "method id";
  }
  const commit = () => { const sc = selScene(); if (sc) { sc[field] = ctrl.value || null; syncStripRow(); scheduleSave(); } };
  ctrl.addEventListener("change", commit);
  if (ctrl.tagName === "INPUT") ctrl.addEventListener("input", commit);
  return ctrl;
}

function transitionSelect(i, value) {
  const s = el("select", "vm-input");
  for (const t of TRANSITIONS) { const o = new Option(t || "默认(cut)", t); if (t === (value || "")) o.selected = true; s.appendChild(o); }
  s.addEventListener("change", () => { const sc = state.sb.scenes[i]; if (s.value) sc.transition = s.value; else delete sc.transition; scheduleSave(); });
  return s;
}

// ─── scene add / delete / reorder ───
function renumber() {
  let t = 0;
  state.sb.scenes.forEach((sc, k) => { sc.index = k + 1; sc.startSec = t; sc.endSec = t + (sc.durationSec || 0); t = sc.endSec; });
}
function moveScene(i, dir) {
  const a = state.sb.scenes, j = i + dir;
  if (j < 0 || j >= a.length) return;
  const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  state.sel = j;
  renumber(); scheduleSave(); renderScenes(); renderBoardHeader();
}
function deleteScene(i) {
  state.sb.scenes.splice(i, 1); renumber(); scheduleSave(); renderScenes(); renderBoardHeader();
}
function addScene() {
  state.sb.scenes.push({ index: 0, cues: [], startSec: 0, endSec: 0, durationSec: 3, text: "", method: null, fallback: null, reasoning: null, assets: [], notes: [] });
  state.sel = state.sb.scenes.length - 1;
  renumber(); scheduleSave(); renderScenes(); renderBoardHeader();
  const ta = $("#detail textarea[data-field='text']"); if (ta) ta.focus();
}
function updateHint() {
  const h = $("#next-hint"); if (!h) return;
  const st = state.sb && state.sb.stages;
  if (!st) { h.textContent = ""; return; }
  let msg;
  if (!st.analyzed) msg = "下一步:点「分析」让 Claude 给每镜挑可视化方法。";
  else if (!state.sb.scenes.some((s) => s.renderedPath)) msg = "下一步:点「全部渲染」出片(或选中镜头「渲染此镜」)。";
  else msg = "下一步:「看整片」检查,或「导出剪辑」交给 Final Cut / DaVinci / 剪映 收尾。";
  h.textContent = "▸ " + msg;
}

// ─── keyboard (board view only, outside form controls) ───
document.addEventListener("keydown", (e) => {
  if ($("#board-view").hidden || !state.sb) return;
  if (e.key === "Escape") return; // lightbox handler owns it
  const tag = (e.target.tagName || "").toUpperCase();
  const inForm = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable;
  if (document.querySelector("dialog[open]")) return;
  if (inForm) return;
  if (e.key === "ArrowUp") { e.preventDefault(); selectScene(Math.max(0, state.sel - 1)); }
  else if (e.key === "ArrowDown") { e.preventDefault(); selectScene(Math.min(state.sb.scenes.length - 1, state.sel + 1)); }
  else if (e.key === "Enter") { const ta = $("#detail textarea[data-field='text']"); if (ta) { e.preventDefault(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
  else if (e.key === "r" || e.key === "R") { const sc = selScene(); if (sc && !state.busy) { e.preventDefault(); runOp("render", { only: sc.index }, `渲染镜头 #${sc.index}`); } }
});

// ─── 整体设计 / 每镜风格 (style presets) ───
function currentDesignSel() {
  return (state.sb && state.sb.project && state.sb.project.design)
    || { presetId: (state.designs && state.designs.default) || "inkwork" };
}
function presetById(id) {
  const list = (state.designs && state.designs.designs) || [];
  return list.find((p) => p.id === id) || list[0] || null;
}
function setColorInput(id, hex) { const c = $("#" + id); if (c && /^#[0-9a-fA-F]{6}$/.test(hex || "")) c.value = hex; }
function setDesignOverride(token, value) {
  const proj = state.sb.project;
  const d = proj.design || (proj.design = { presetId: currentDesignSel().presetId });
  (d.overrides = d.overrides || {})[token] = value;
  scheduleSave();
}
function bindColorInput(id, token) { const c = $("#" + id); if (c) c.oninput = () => setDesignOverride(token, c.value); }

function openDesignDialog() {
  if (!state.designs || !state.sb) return toast("设计预设未加载", "error");
  const dlg = $("#design-dialog");
  const sel = $("#dz-preset");
  sel.innerHTML = "";
  for (const p of state.designs.designs) sel.appendChild(new Option(p.name, p.id));
  sel.value = currentDesignSel().presetId;
  const paint = () => {
    const p = presetById(sel.value); if (!p) return;
    const ov = (state.sb.project.design && state.sb.project.design.overrides) || {};
    $("#dz-when").textContent = p.whenToUse || "";
    setColorInput("dz-paper", ov.paper || p.tokens.paper);
    setColorInput("dz-ink", ov.ink || p.tokens.ink);
    setColorInput("dz-accent", ov.accent || p.tokens.accent);
    $("#dz-display").value = ov.display || p.tokens.display || "serif";
  };
  sel.onchange = () => { state.sb.project.design = { presetId: sel.value }; paint(); scheduleSave(); };
  bindColorInput("dz-paper", "paper"); bindColorInput("dz-ink", "ink"); bindColorInput("dz-accent", "accent");
  $("#dz-display").onchange = (e) => setDesignOverride("display", e.target.value);
  $("#dz-reset").onclick = () => { state.sb.project.design = { presetId: sel.value }; paint(); scheduleSave(); toast("已恢复预设默认"); };
  $("#dz-apply").onclick = async () => { dlg.close(); await save(); runOp("render", {}, "应用设计并重渲染"); };
  paint();
  dlg.showModal();
}

function scenePresetSelect(i, style) {
  const s = el("select", "vm-input");
  s.appendChild(new Option("继承整体", ""));
  for (const p of ((state.designs && state.designs.designs) || [])) {
    const o = new Option(p.name, p.id);
    if (style && style.presetId === p.id) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener("change", () => {
    const sc = state.sb.scenes[i];
    if (!s.value) delete sc.style; else sc.style = { presetId: s.value };
    scheduleSave();
  });
  return s;
}

function stStatusText(s) { return { pending: "待渲染", rendering: "渲染中", rendered: "已渲染", failed: "失败" }[s] || s; }

// ─── save (debounced PUT of whole storyboard) ───
function scheduleSave() {
  state.dirty = true;
  setSaveStatus("saving", "保存中…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 600);
}
async function save() {
  if (!state.sb) return;
  try {
    await api(`/api/projects/${state.pid}/storyboard`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state.sb) });
    state.dirty = false;
    setSaveStatus("", "已保存");
  } catch (e) {
    // Render in progress rejects the save (409) so it can't clobber the render's
    // incremental writes. Keep the local edits and retry once the render frees up
    // — never report "已保存" when the bytes didn't land.
    if (/渲染进行中|409/.test(e.message)) {
      setSaveStatus("saving", "渲染中,稍后自动保存");
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(save, 5000);
    } else {
      setSaveStatus("error", "保存失败"); toast("保存失败:" + e.message, "error");
    }
  }
}
function setSaveStatus(state_, text) { const s = $("#save-status"); s.dataset.state = state_; s.textContent = text; }

// ─── ops (analyze / images / render) with task polling ───
// Returns true only when the task genuinely succeeded, so callers like 「看整片」
// can refuse to play a stale artifact after a failed stitch.
async function runOp(op, body, label) {
  if (state.busy) { toast("有任务在跑,稍候"); return false; }
  state.busy = true; setOpsDisabled(true);
  $("#task-report").hidden = true;
  const bar = $("#task-bar"); bar.hidden = false;
  $("#task-label").textContent = label || op; $("#task-fill").style.width = "4%"; $("#task-log").textContent = "启动…";
  const cancelBtn = $("#task-cancel"); cancelBtn.hidden = false; cancelBtn.disabled = false;
  state.lastTask = null;
  let ok = false, taskErr = null;
  try {
    const task = await api(`/api/projects/${state.pid}/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    state.curTask = task.id;
    await pollTask(task.id);
    ok = true;
  } catch (e) { taskErr = e; }
  state.curTask = null; cancelBtn.hidden = true;
  // Always reconcile with disk — even on FAILURE the task may have written
  // per-scene render state (renderedPath/hash/status) that the pre-task local
  // copy lacks; a naive overwrite either way would lose data.
  try {
    const fresh = await api(`/api/projects/${state.pid}/storyboard`).catch(() => null);
    if (fresh) reconcileAfterTask(fresh);
  } catch {}
  await showTaskReport(op, taskErr);
  state.busy = false; setOpsDisabled(false);
  setTimeout(() => { if (!state.busy) $("#task-bar").hidden = true; }, 1400);
  if (taskErr) toast(`${label || op} 失败:${taskErr.message}`, "error");
  else toast(`${label || op} 完成`);
  return ok;
}
function setOpsDisabled(d) { document.querySelectorAll(".op, .d-render").forEach((b) => (b.disabled = d)); }

// Merge disk state after a task WITHOUT discarding unsaved local edits. When the
// board is clean, disk is authoritative (wholesale replace). When there are
// unsaved edits, keep them and graft only render-owned fields, then persist the
// merge — otherwise the pending autosave PUT would clobber renderedPath/stages.
function reconcileAfterTask(fresh) {
  if (!state.dirty) {
    state.sb = fresh; renderBoardHeader(); renderScenes(); return;
  }
  const byIdx = new Map((fresh.scenes || []).map((s) => [s.index, s]));
  for (const sc of state.sb.scenes) {
    const d = byIdx.get(sc.index);
    if (d) { sc.renderedPath = d.renderedPath; sc.renderedHash = d.renderedHash; sc.status = d.status; }
  }
  if (fresh.stages) state.sb.stages = fresh.stages;
  renderBoardHeader(); renderScenes();
  scheduleSave(); // persist merged copy (local edits + freshly-written render fields)
}

async function pollTask(id) {
  let misses = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    let t;
    try { t = await api(`/api/tasks/${id}`); misses = 0; }
    catch (e) {
      // Daemon restarted / task table cleared / token rotated → the task id is
      // gone. Don't spin forever locking the UI; after a few misses, bail out.
      if (++misses >= 5) throw new Error("与后台失联(daemon 可能已重启)— 刷新页面重连");
      continue;
    }
    state.lastTask = t;
    $("#task-fill").style.width = Math.max(4, t.progressPct || 0) + "%";
    $("#task-log").textContent = (t.log && t.log[t.log.length - 1]) || t.message || "";
    if (t.status === "succeeded") return;
    if (t.status === "failed") throw new Error(t.error || t.message || "task failed");
    if (t.status === "cancelled") throw new Error("已取消");
  }
}

// Surface what a task actually produced: pre-render validate errors + per-scene
// render failures + the post-render self-review verdict — instead of the single
// ephemeral log line the user used to get.
async function showTaskReport(op, taskErr) {
  const panel = $("#task-report"), list = $("#tr-list");
  const items = [];
  if (taskErr) {
    items.push({ level: "error", msg: taskErr.message });
    // The concrete reasons (validate ✗ lines, per-scene FAILED) live in the log.
    for (const l of (state.lastTask?.log || []).slice(-12)) {
      if (/✗|✘|FAILED|校验|missing-|stale-|missing_/i.test(l)) items.push({ level: "warn", msg: l.replace(/^\[\d\d:\d\d:\d\d\]\s*/, "") });
    }
  }
  for (const s of (state.sb?.scenes || [])) {
    if (s.status === "failed") items.push({ level: "error", msg: `镜头 #${s.index} 渲染失败` });
  }
  if (op === "render" || op === "stitch") {
    const qa = await api(`/api/projects/${state.pid}/files/output/qa-report.json`).catch(() => null);
    if (qa && Array.isArray(qa.findings)) {
      const v = qa.status;
      items.unshift({ level: v === "fail" ? "error" : v === "warn" ? "warn" : "ok", msg: `成片自检:${v === "pass" ? "通过 ✓" : v === "warn" ? "有提醒" : "未通过"}` });
      for (const f of qa.findings) if (f.level && f.level !== "info") items.push({ level: f.level === "error" ? "error" : "warn", msg: f.msg });
    }
  }
  if (!items.length) { panel.hidden = true; return; }
  $("#tr-title").textContent = `${label(op)} · 报告`;
  list.innerHTML = "";
  for (const it of items) { const row = el("div", "tr-item " + it.level); row.textContent = it.msg; list.appendChild(row); }
  panel.hidden = false;
}
function label(op) { return { analyze: "分析", images: "配图", tts: "配音", bgm: "配乐", render: "全部渲染", stitch: "拼接整片" }[op] || op; }

// ─── lightbox ───
function lightbox(kind, src) {
  const stage = $("#lb-stage"); stage.innerHTML = "";
  const m = kind === "video" ? el("video") : el("img"); m.src = src;
  if (kind === "video") { m.controls = true; m.autoplay = true; m.loop = true; }
  m.addEventListener("error", () => { $("#lightbox").hidden = true; toast("素材未找到(可能还没渲染)", "error"); });
  stage.appendChild(m); $("#lightbox").hidden = false;
}
$("#lb-close").addEventListener("click", () => ($("#lightbox").hidden = true));
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") $("#lightbox").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#lightbox").hidden = true; });

// ─── new project ───
$("#new-project").addEventListener("click", () => $("#new-dialog").showModal());
document.querySelectorAll("#new-dialog [data-close]").forEach((b) => b.addEventListener("click", () => $("#new-dialog").close()));
$("#np-create").addEventListener("click", async () => {
  const title = $("#np-title").value.trim(); const srt = $("#np-srt").value.trim();
  if (!title) return toast("填项目名称", "error");
  if (!srt) return toast("粘贴 SRT 字幕", "error");
  try {
    const proj = await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, srt }) });
    await api(`/api/projects/${proj.id}/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, width: +$("#np-w").value || 1920, height: +$("#np-h").value || 1080 }) });
    $("#new-dialog").close();
    toast("已切分镜");
    openProject(proj.id);
  } catch (e) { toast("创建失败:" + e.message, "error"); }
});

// ─── nav ───
$("#brand").addEventListener("click", showProjects);
$("#back-home").addEventListener("click", showProjects);
$("#refresh-projects").addEventListener("click", loadProjects);
document.querySelectorAll(".op").forEach((b) => b.addEventListener("click", () => {
  const op = b.dataset.op;
  runOp(op, {}, { analyze: "分析镜头", images: "生成配图", tts: "生成配音", bgm: "生成配乐", render: "全部渲染" }[op]);
}));

const dzBtn = document.querySelector("[data-op-design]");
if (dzBtn) dzBtn.addEventListener("click", openDesignDialog);
document.querySelectorAll("#design-dialog [data-dz-close]").forEach((b) => b.addEventListener("click", () => $("#design-dialog").close()));

const finalBtn = document.querySelector("[data-op-final]");
if (finalBtn) finalBtn.addEventListener("click", async () => {
  if (!state.pid || !state.sb) return;
  const scenes = state.sb.scenes || [];
  const allRendered = scenes.length > 0 && scenes.every((s) => s.renderedPath);
  if (!allRendered) return toast("还有镜头未渲染 — 先「全部渲染」或选中镜头「渲染此镜」", "error");
  // Re-assemble final.mp4 from the rendered scenes (reliable, no re-render), then
  // play. Only play if the stitch actually succeeded — otherwise we'd show a
  // stale final.mp4 from a previous run and pass it off as the new one.
  const ok = await runOp("stitch", {}, "拼接整片");
  if (!ok) return;
  const u = fileUrl("output/final.mp4");
  lightbox("video", u + (u.includes("?") ? "&" : "?") + "_=" + Date.now());
});

// Cancel the running task (best-effort — server signals cancelRequested).
$("#task-cancel").addEventListener("click", async () => {
  if (!state.curTask) return;
  $("#task-cancel").disabled = true;
  try { await api(`/api/tasks/${state.curTask}/cancel`, { method: "POST" }); toast("已请求取消…"); }
  catch (e) { $("#task-cancel").disabled = false; toast("取消失败:" + e.message, "error"); }
});
$("#tr-close").addEventListener("click", () => ($("#task-report").hidden = true));
const addSceneBtn = document.querySelector("#add-scene");
if (addSceneBtn) addSceneBtn.addEventListener("click", () => { if (state.sb) addScene(); });

const exportBtn = document.querySelector("[data-op-export]");
if (exportBtn) exportBtn.addEventListener("click", () => {
  if (!state.pid) return;
  const url = `/api/projects/${state.pid}/export/fcpxml${TOKEN ? "?token=" + encodeURIComponent(TOKEN) : ""}`;
  window.open(url, "_blank");
  toast("已导出 FCPXML(仅含已渲染镜头;可在 Final Cut / DaVinci / 剪映 打开)");
});

const lintBtn = document.querySelector("[data-op-lint]");
if (lintBtn) lintBtn.addEventListener("click", runLint);
async function runLint() {
  if (!state.pid) return;
  try {
    const r = await api(`/api/projects/${state.pid}/lint`, { method: "POST" });
    const map = {}; let n = 0;
    for (const s of (r.scenes || [])) { if (s.findings && s.findings.length) { map[s.index] = s.findings; n++; } }
    state.lint = map; renderScenes();
    toast(n ? `${n} 个镜头有土味提示(看 ⚠ 标记,悬停看详情)` : "✓ 全部干净,无 AI 土味", n ? "error" : "");
  } catch (e) { toast("土味检查失败:" + e.message, "error"); }
}

const initProject = new URLSearchParams(location.search).get("project");
if (initProject) openProject(initProject); else showProjects();
