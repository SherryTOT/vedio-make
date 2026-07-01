// Vedio Make 分镜台 — vanilla front-end on top of the existing pipeline daemon.
const TOKEN = window.__PIPELINE_TOKEN__ || new URLSearchParams(location.search).get("token") || "";
const AUTH = TOKEN ? { Authorization: "Bearer " + TOKEN } : {};
const $ = (s) => document.querySelector(s);

const TRANSITIONS = ["", "cut", "fade", "dip-to-black", "wipe-left", "wipe-right", "push-up"];
const state = { pid: null, sb: null, catalog: null, designs: null, lint: null, saveTimer: null, busy: false };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...AUTH } });
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("json") ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) throw new Error((body && body.error) || (typeof body === "string" ? body.slice(0, 200) : `HTTP ${r.status}`));
  return body;
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
    const card = el("article", "pcard");
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
  try { detail = await api(`/api/projects/${id}`); } catch (e) { return toast("打开失败:" + e.message, "error"); }
  state.sb = detail.storyboard;
  state.catalog = await loadCatalog(id);
  state.designs = await api("/api/designs").catch(() => null);
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

// ─── scene table ───
function renderScenes() {
  const body = $("#scenes-body");
  body.innerHTML = "";
  if (!state.sb || !state.sb.scenes.length) { body.appendChild(el("tr", "", `<td colspan="7" class="pv-empty" style="height:120px">这个项目还没有 storyboard。先在 Claude 里跑 plan / analyze,或新建项目。</td>`)); return; }
  state.sb.scenes.forEach((sc, i) => body.appendChild(buildRow(sc, i)));
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
  renumber(); scheduleSave(); renderScenes(); renderBoardHeader();
}
function deleteScene(i) {
  state.sb.scenes.splice(i, 1); renumber(); scheduleSave(); renderScenes(); renderBoardHeader();
}
function addScene() {
  state.sb.scenes.push({ index: 0, cues: [], startSec: 0, endSec: 0, durationSec: 3, text: "", method: null, fallback: null, reasoning: null, assets: [], notes: [] });
  renumber(); scheduleSave(); renderScenes(); renderBoardHeader();
}
function updateHint() {
  const h = $("#next-hint"); if (!h) return;
  const st = state.sb && state.sb.stages;
  if (!st) { h.textContent = ""; return; }
  let msg;
  if (!st.analyzed) msg = "下一步:点「分析」让 Claude 给每镜挑可视化方法。";
  else if (!state.sb.scenes.some((s) => s.renderedPath)) msg = "下一步:点「全部渲染」出片(或单镜「渲染此条」)。";
  else msg = "下一步:「看整片」检查,或「导出剪辑」交给 Final Cut / DaVinci / 剪映 收尾。";
  h.textContent = "▸ " + msg;
}

function buildRow(sc, i) {
  const tr = el("tr");
  tr.dataset.i = i;

  // # + time
  const idx = el("td"); const ic = el("div", "idx-cell");
  ic.appendChild(el("span", "n", "#" + (sc.index ?? i + 1)));
  ic.appendChild(el("span", "t", `${fmt(sc.startSec)}–${fmt(sc.endSec)}<br>${(sc.durationSec || 0).toFixed(1)}s`));
  const ctl = el("div", "row-ctl");
  const rcBtn = (txt, cls, title, fn) => { const b = el("button", "rc" + (cls ? " " + cls : ""), txt); b.title = title; b.addEventListener("click", fn); return b; };
  ctl.append(rcBtn("↑", "", "上移", () => moveScene(i, -1)), rcBtn("↓", "", "下移", () => moveScene(i, 1)), rcBtn("✕", "rc-del", "删除镜头", () => deleteScene(i)));
  ic.appendChild(ctl);
  idx.appendChild(ic); tr.appendChild(idx);

  // text
  tr.appendChild(cellTextarea("text", sc.text || "", "字幕文本"));

  // method + fallback
  const mc = el("td"); const wrap = el("div", "method-cell");
  wrap.appendChild(methodControl("method", sc.method, "方法"));
  wrap.appendChild(methodControl("fallback", sc.fallback, "备选(需 S 档)"));
  mc.appendChild(wrap); tr.appendChild(mc);

  // reasoning
  tr.appendChild(cellTextarea("reasoning", sc.reasoning || "", "理由"));

  // extras: assets chips + transition + motion/style chips
  const ex = el("td"); const exr = el("div", "extra-row");
  if (sc.assets && sc.assets.length) { const c = el("div", "chips"); sc.assets.forEach((a) => c.appendChild(el("span", "chip asset", esc(a.split("/").pop())))); exr.appendChild(labeled("资源", c)); }
  exr.appendChild(labeled("转场", transitionSelect(i, sc.transition)));
  if (state.designs) exr.appendChild(labeled("风格", scenePresetSelect(i, sc.style)));
  const badges = el("div", "chips");
  if (sc.motion && sc.motion.kind && sc.motion.kind !== "still") badges.appendChild(el("span", "chip", "运镜·" + sc.motion.kind));
  if (sc.imageStyle) badges.appendChild(el("span", "chip", esc(sc.imageStyle)));
  if (sc.needsMatting) badges.appendChild(el("span", "chip", "抠像"));
  if (sc.burnSubtitle) badges.appendChild(el("span", "chip", "烧字幕"));
  if (sc.style) badges.appendChild(el("span", "chip", "风格·" + (sc.style.presetId || "自定义")));
  const lf = state.lint && state.lint[sc.index];
  if (lf && lf.length) { const c = el("span", "chip chip-warn", "⚠ 土味 " + lf.length); c.title = lf.map((f) => f.msg).join("\n"); badges.appendChild(c); }
  if (badges.children.length) exr.appendChild(labeled("修饰", badges));
  ex.appendChild(exr); tr.appendChild(ex);

  // notes (string[])
  tr.appendChild(cellTextarea("notes", (sc.notes || []).join("\n"), "备注(每行一条)"));

  // preview + render
  tr.appendChild(previewCell(sc, i));
  return tr;
}

function labeled(label, node) { const w = el("div"); w.appendChild(el("div", "field-label", label)); w.appendChild(node); return w; }

function cellTextarea(field, value, ph) {
  const td = el("td");
  const ta = el("textarea"); ta.dataset.field = field; ta.value = value; ta.placeholder = ph || "";
  ta.addEventListener("input", () => { applyField(td, field, ta.value); scheduleSave(); });
  td.appendChild(ta); return td;
}
function applyField(td, field, value) {
  const i = +td.parentElement.dataset.i; const sc = state.sb.scenes[i];
  if (field === "notes") sc.notes = value.split("\n").map((s) => s.trim()).filter(Boolean);
  else if (field === "reasoning") sc.reasoning = value || null;
  else sc[field] = value;
}

function methodControl(field, value, label) {
  const wrap = el("div");
  wrap.appendChild(el("div", "field-label", label));
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
  ctrl.addEventListener("change", () => { const tr = wrap.closest("tr"); state.sb.scenes[+tr.dataset.i][field] = ctrl.value || null; scheduleSave(); });
  if (ctrl.tagName === "INPUT") ctrl.addEventListener("input", () => { const tr = wrap.closest("tr"); state.sb.scenes[+tr.dataset.i][field] = ctrl.value || null; scheduleSave(); });
  wrap.appendChild(ctrl); return wrap;
}

function transitionSelect(i, value) {
  const s = el("select", "vm-input");
  for (const t of TRANSITIONS) { const o = new Option(t || "默认(cut)", t); if (t === (value || "")) o.selected = true; s.appendChild(o); }
  s.addEventListener("change", () => { const sc = state.sb.scenes[i]; if (s.value) sc.transition = s.value; else delete sc.transition; scheduleSave(); });
  return s;
}

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

function previewCell(sc, i) {
  const td = el("td"); const cell = el("div", "preview-cell");
  const frame = el("div", "pv-frame");
  if (sc.renderedPath) {
    const v = el("video"); v.src = fileUrl(sc.renderedPath); v.muted = true; v.loop = true; v.playsInline = true;
    v.addEventListener("mouseenter", () => v.play().catch(() => {}));
    v.addEventListener("mouseleave", () => v.pause());
    v.addEventListener("click", () => lightbox("video", v.src));
    frame.appendChild(v);
  } else {
    const img = sc.assets && sc.assets.find((a) => /\.(png|jpe?g|webp|gif)$/i.test(a));
    if (img) { const im = el("img"); im.src = fileUrl(img.startsWith("assets/") ? img : "assets/" + img); im.addEventListener("click", () => lightbox("img", im.src)); frame.appendChild(im); }
    else frame.appendChild(el("div", "pv-empty", "未渲染"));
  }
  cell.appendChild(frame);
  const foot = el("div", "pv-foot");
  const status = sc.status || (sc.renderedPath ? "rendered" : "pending");
  const stEl = el("span", "st", stStatusText(status)); stEl.dataset.s = status;
  foot.appendChild(stEl);
  const btn = el("button", "render-one", "渲染此条");
  btn.addEventListener("click", () => runOp("render", { only: sc.index }, `渲染镜头 #${sc.index}`));
  foot.appendChild(btn);
  cell.appendChild(foot);
  td.appendChild(cell); return td;
}
function stStatusText(s) { return { pending: "待渲染", rendering: "渲染中", rendered: "已渲染", failed: "失败" }[s] || s; }

// ─── save (debounced PUT of whole storyboard) ───
function scheduleSave() {
  setSaveStatus("saving", "保存中…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 600);
}
async function save() {
  if (!state.sb) return;
  try {
    await api(`/api/projects/${state.pid}/storyboard`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state.sb) });
    setSaveStatus("", "已保存");
  } catch (e) { setSaveStatus("error", "保存失败"); toast("保存失败:" + e.message, "error"); }
}
function setSaveStatus(state_, text) { const s = $("#save-status"); s.dataset.state = state_; s.textContent = text; }

// ─── ops (analyze / images / render) with task polling ───
async function runOp(op, body, label) {
  if (state.busy) return toast("有任务在跑,稍候");
  state.busy = true; setOpsDisabled(true);
  const bar = $("#task-bar"); bar.hidden = false;
  $("#task-label").textContent = label || op; $("#task-fill").style.width = "4%"; $("#task-log").textContent = "启动…";
  try {
    const task = await api(`/api/projects/${state.pid}/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    await pollTask(task.id);
    const fresh = await api(`/api/projects/${state.pid}/storyboard`).catch(() => null);
    if (fresh) { state.sb = fresh; renderBoardHeader(); renderScenes(); }
    toast(`${label || op} 完成`);
  } catch (e) { toast(`${label || op} 失败:${e.message}`, "error"); }
  finally { state.busy = false; setOpsDisabled(false); setTimeout(() => ($("#task-bar").hidden = true), 1200); }
}
function setOpsDisabled(d) { document.querySelectorAll(".op, .render-one").forEach((b) => (b.disabled = d)); }
async function pollTask(id) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    let t;
    try { t = await api(`/api/tasks/${id}`); } catch { continue; }
    $("#task-fill").style.width = Math.max(4, t.progressPct || 0) + "%";
    $("#task-log").textContent = (t.log && t.log[t.log.length - 1]) || t.message || "";
    if (t.status === "succeeded") return;
    if (t.status === "failed") throw new Error(t.error || t.message || "task failed");
    if (t.status === "cancelled") throw new Error("已取消");
  }
}

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
  runOp(op, op === "render" ? {} : {}, { analyze: "分析镜头", images: "生成配图", render: "全部渲染" }[op]);
}));

const dzBtn = document.querySelector("[data-op-design]");
if (dzBtn) dzBtn.addEventListener("click", openDesignDialog);
document.querySelectorAll("#design-dialog [data-dz-close]").forEach((b) => b.addEventListener("click", () => $("#design-dialog").close()));

const finalBtn = document.querySelector("[data-op-final]");
if (finalBtn) finalBtn.addEventListener("click", async () => {
  if (!state.pid || !state.sb) return;
  const scenes = state.sb.scenes || [];
  const allRendered = scenes.length > 0 && scenes.every((s) => s.renderedPath);
  if (!allRendered) return toast("还有镜头未渲染 — 先「全部渲染」或逐镜「渲染此条」", "error");
  // Re-assemble final.mp4 from the rendered scenes (reliable, no re-render), then play.
  try { await runOp("stitch", {}, "拼接整片"); } catch { return; }
  const u = fileUrl("output/final.mp4");
  lightbox("video", u + (u.includes("?") ? "&" : "?") + "_=" + Date.now());
});
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
