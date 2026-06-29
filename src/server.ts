/**
 * Pipeline HTTP daemon — exposes the CLI's operations over HTTP so a Mac app
 * (or any client) can drive the pipeline without spawning Node subprocesses.
 *
 * Design mirrors Restate's pattern:
 *   - Bearer token auth (env: PIPELINE_TOKEN, or auto-generated and printed)
 *   - Async tasks: POST returns a task id immediately, GET polls status
 *   - In-memory task queue + log buffer (resets on restart — projects on disk)
 *   - Files served by GET /api/projects/{id}/files/{name}
 *   - SSE event stream per task for live progress (browser EventSource ready)
 *
 * Endpoints:
 *   GET  /api/health
 *   GET  /api/server                                  → { name, version, port }
 *   GET  /api/providers                               → list available providers per capability
 *   POST /api/projects        { title, srt? }         → { id, dir }
 *   GET  /api/projects                                → list
 *   GET  /api/projects/{id}                           → { storyboard, files, tasks }
 *   POST /api/projects/{id}/srt                       → upload SRT text (body: { srt: "…" })
 *   POST /api/projects/{id}/plan                      → run `plan` synchronously (fast)
 *   POST /api/projects/{id}/<op>                      → enqueue task; op ∈ {analyze, images, research, matte, tts, bgm, render}
 *   GET  /api/projects/{id}/storyboard                → storyboard.json (with motion / focus / etc.)
 *   PUT  /api/projects/{id}/storyboard                → replace storyboard.json (for client-side edits)
 *   GET  /api/projects/{id}/files                     → list files in output/ + assets/
 *   GET  /api/projects/{id}/files/{name...}           → stream a file
 *   GET  /api/tasks                                   → list all tasks
 *   GET  /api/tasks/{taskId}                          → { status, progress, log }
 *   GET  /api/tasks/{taskId}/events                   → SSE stream (text/event-stream)
 *   POST /api/tasks/{taskId}/cancel                   → best-effort cancel
 *
 * No HTTPS, no CORS-deny — designed for localhost / LAN only.
 */

import http from "node:http";
import { URL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { runPlan } from "./plan.ts";
import { runAnalyze } from "./analyze.ts";
import { runResearch } from "./research.ts";
import { runImages } from "./images.ts";
import { runMatte } from "./matte.ts";
import { runTts } from "./tts.ts";
import { runBgm } from "./bgm.ts";
import { runRender } from "./render.ts";
import { writeStoryboardHtml } from "./storyboard.ts";
import { listProviders } from "./providers/registry.ts";
import { DESIGNS, DEFAULT_DESIGN_ID } from "./methods/designs.ts";
import { lintStoryboard } from "./methods/lint.ts";
import { buildFcpxml, buildEdl } from "./export_nle.ts";

const VERSION = "0.2.0";

// ─── Task model ──────────────────────────────────────────────────────────
interface Task {
  id: string;
  projectId: string;
  op: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  startedAt?: number;
  finishedAt?: number;
  progressPct: number;
  message: string;
  error?: string;
  log: string[];          // recent log lines
  cancelRequested?: boolean;
}

const tasks = new Map<string, Task>();
const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(50);

function makeTask(projectId: string, op: string): Task {
  const t: Task = {
    id: crypto.randomBytes(6).toString("hex"),
    projectId,
    op,
    status: "queued",
    progressPct: 0,
    message: "",
    log: [],
  };
  tasks.set(t.id, t);
  return t;
}

function pushLog(t: Task, line: string): void {
  t.log.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
  if (t.log.length > 200) t.log = t.log.slice(-200);
  taskEvents.emit(t.id, t);
}

function setStatus(t: Task, status: Task["status"], msg = "", err?: string): void {
  t.status = status;
  if (status === "running" && !t.startedAt) t.startedAt = Date.now();
  if (["succeeded", "failed", "cancelled"].includes(status)) t.finishedAt = Date.now();
  if (msg) t.message = msg;
  if (err) t.error = err;
  taskEvents.emit(t.id, t);
}

/** Hijack console.log/error so per-task logs collect render output. */
function captureLogs(task: Task, fn: () => Promise<unknown>): Promise<unknown> {
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    pushLog(task, line);
    origLog(...args);
  };
  console.error = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    pushLog(task, `ERROR: ${line}`);
    origErr(...args);
  };
  return fn().finally(() => {
    console.log = origLog;
    console.error = origErr;
  });
}

// ─── Projects model ──────────────────────────────────────────────────────
interface Project {
  id: string;
  title: string;
  dir: string;
  createdAt: number;
}

let projectsRoot = "";
const projects = new Map<string, Project>();

function loadProjects(): void {
  if (!fs.existsSync(projectsRoot)) {
    fs.mkdirSync(projectsRoot, { recursive: true });
    return;
  }
  for (const name of fs.readdirSync(projectsRoot)) {
    const dir = path.join(projectsRoot, name);
    const metaPath = path.join(dir, "project.json");
    if (fs.statSync(dir).isDirectory() && fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Project;
        projects.set(meta.id, { ...meta, dir });
      } catch {}
    }
  }
}

function createProject(title: string): Project {
  const id = crypto.randomBytes(4).toString("hex");
  const safe = title.replace(/[^a-zA-Z0-9_一-鿿-]+/g, "_").slice(0, 40);
  const dir = path.join(projectsRoot, `${safe || "untitled"}-${id}`);
  fs.mkdirSync(path.join(dir, "input"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(dir, "output"), { recursive: true });
  // Symlink shared catalog + design from the main pipeline root so every
  // project sees the same method definitions and brand.
  for (const file of ["methods", "design.md"]) {
    const src = path.resolve(process.cwd(), file);
    const dst = path.join(dir, file);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try {
        fs.symlinkSync(src, dst);
      } catch {
        // Fall back to copy on platforms without symlink support
        if (fs.statSync(src).isDirectory()) {
          fs.cpSync(src, dst, { recursive: true });
        } else {
          fs.copyFileSync(src, dst);
        }
      }
    }
  }
  const meta: Project = { id, title, dir, createdAt: Date.now() };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(meta, null, 2));
  projects.set(id, meta);
  return meta;
}

// ─── Task runners — dispatch into the existing CLI modules ───────────────
async function runTaskBody(t: Task, body: any): Promise<void> {
  const proj = projects.get(t.projectId);
  if (!proj) throw new Error(`unknown project ${t.projectId}`);

  const sbPath = path.join(proj.dir, "output/storyboard.json");
  const catalogPath = path.join(proj.dir, "methods/catalog.json");
  const designPath = path.join(proj.dir, "design.md");
  const assetsDir = path.join(proj.dir, "assets");

  switch (t.op) {
    case "analyze":
      await runAnalyze({
        storyboardPath: sbPath, catalogPath, designPath, assetsDir,
        projectRoot: proj.dir, fillOnly: body.fillOnly ?? false,
        provider: body.provider,
      });
      break;
    case "research":
      await runResearch({
        storyboardPath: sbPath, force: body.force ?? false,
        searchProvider: body.searchProvider, chatProvider: body.chatProvider,
      });
      break;
    case "images":
      await runImages({
        storyboardPath: sbPath, assetsDir, designPath,
        projectRoot: proj.dir,
        force: body.force ?? false,
        provider: body.provider,
        chatProvider: body.chatProvider,
        aspectRatio: body.aspect,
        onlyIndices: body.scenes,
        rawPrompts: body.rawPrompts ?? false,
      });
      break;
    case "matte":
      await runMatte({
        projectRoot: proj.dir,
        storyboardPath: sbPath,
        inputPath: body.input,
        assetPath: body.asset,
        allGenerated: body.allGenerated ?? false,
        sceneIndex: body.scene,
        force: body.force ?? false,
        device: body.device,
      });
      break;
    case "tts":
      await runTts({
        storyboardPath: sbPath,
        voiceDir: path.join(proj.dir, "output/voice"),
        trackPath: path.join(proj.dir, "output/voice-track.json"),
        projectRoot: proj.dir,
        voiceId: body.voice ?? "presenter_male",
        speed: body.speed ?? 1.0,
        force: body.force ?? false,
        provider: body.provider,
      });
      break;
    case "bgm":
      await runBgm({
        storyboardPath: sbPath,
        outPath: path.join(proj.dir, "output/bgm.mp3"),
        force: body.force ?? false,
        promptOverride: body.prompt,
        provider: body.provider,
      });
      break;
    case "render":
      // Full render (only==null) from the app = the user's deliberate approval.
      if ((body.only ?? null) === null) {
        try {
          const _sb = JSON.parse(fs.readFileSync(sbPath, "utf8"));
          if (_sb.stages && !_sb.stages.approved) { _sb.stages.approved = true; fs.writeFileSync(sbPath, JSON.stringify(_sb, null, 2)); }
        } catch {}
      }
      await runRender({
        storyboardPath: sbPath,
        outputDir: path.join(proj.dir, "output"),
        projectRoot: proj.dir,
        force: body.force ?? false,
        only: body.only ?? null,
      });
      break;
    case "storyboard":
      writeStoryboardHtml(sbPath, catalogPath, path.join(proj.dir, "output/storyboard.html"));
      break;
    default:
      throw new Error(`unknown op '${t.op}'`);
  }
}

async function dispatchTask(t: Task, body: any): Promise<void> {
  setStatus(t, "running");
  try {
    await captureLogs(t, () => runTaskBody(t, body));
    if (t.cancelRequested) {
      setStatus(t, "cancelled", "cancelled by user");
    } else {
      setStatus(t, "succeeded", "done");
      t.progressPct = 100;
    }
  } catch (e) {
    const err = (e as Error).message ?? String(e);
    setStatus(t, "failed", "task failed", err);
  }
}

// ─── HTTP plumbing ───────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, body: string, contentType = "text/plain"): void {
  res.writeHead(status, { "Content-Type": `${contentType}; charset=utf-8` });
  res.end(body);
}

// ─── Static UI (the storyboard 分镜台 web front-end in ../public) ──────────
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const STATIC_MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

/** Serve index.html with the bearer token injected, so the same-origin page can call /api/*. */
function serveIndexHtml(res: http.ServerResponse, token: string): void {
  const idx = path.join(PUBLIC_DIR, "index.html");
  if (!fs.existsSync(idx)) return sendJson(res, 404, { error: "UI not built (public/index.html missing)" });
  const html = fs
    .readFileSync(idx, "utf8")
    .replace("</head>", `<script>window.__PIPELINE_TOKEN__=${JSON.stringify(token || "")}</script></head>`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

/** Static file server for public/ — no auth (the page must boot before it has a token). */
function serveStatic(res: http.ServerResponse, pathname: string, token: string): void {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") return serveIndexHtml(res, token);
  const abs = path.resolve(PUBLIC_DIR, "." + rel);
  if (!abs.startsWith(PUBLIC_DIR) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    // Unknown non-asset path → fall back to the SPA shell.
    if (path.extname(abs) === "") return serveIndexHtml(res, token);
    return sendJson(res, 404, { error: "not found" });
  }
  const ext = path.extname(abs).toLowerCase();
  if (ext === ".html") return serveIndexHtml(res, token);
  res.writeHead(200, {
    "Content-Type": `${STATIC_MIME[ext] ?? "application/octet-stream"}; charset=utf-8`,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(abs).pipe(res);
}

function authOK(req: http.IncomingMessage, token: string): boolean {
  if (!token) return true; // dev: no token configured → open
  const h = req.headers.authorization ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m && m[1] === token) return true;
  // Allow ?token= for same-origin media elements (<video>/<img>) that can't send headers.
  try {
    const u = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (u.searchParams.get("token") === token) return true;
  } catch {}
  return false;
}

/** Stamp a default style preset on a storyboard body that lacks one. Never throws. */
function ensureDesignDefault(raw: string): string {
  try {
    const sb = JSON.parse(raw);
    if (sb?.project && !sb.project.design) {
      sb.project.design = { presetId: DEFAULT_DESIGN_ID };
      return JSON.stringify(sb);
    }
    return raw;
  } catch {
    return raw; // malformed → write verbatim, never 500
  }
}

export async function startServer(opts: {
  port: number;
  host: string;
  token: string;
  projectsDir: string;
}): Promise<http.Server> {
  projectsRoot = opts.projectsDir;
  loadProjects();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const route = `${req.method} ${url.pathname}`;

      // Open endpoints
      if (route === "GET /api/health") return sendJson(res, 200, { ok: true, version: VERSION });
      if (route === "GET /api/server") {
        return sendJson(res, 200, { name: "video-pipeline", version: VERSION, port: opts.port });
      }

      // Static UI (public/) — served WITHOUT auth so the page can boot; /api/* stays gated below.
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        return serveStatic(res, url.pathname, opts.token);
      }

      // Auth gate
      if (!authOK(req, opts.token)) {
        return sendJson(res, 401, { error: "missing or wrong bearer token" });
      }

      if (route === "GET /api/providers") {
        return sendJson(res, 200, {
          chat:   listProviders("chat"),
          tts:    listProviders("tts"),
          music:  listProviders("music"),
          image:  listProviders("image"),
          search: listProviders("search"),
        });
      }

      // Style preset catalog — the 分镜台 reads this to populate the 整体设计 picker.
      if (route === "GET /api/designs") {
        return sendJson(res, 200, {
          default: DEFAULT_DESIGN_ID,
          designs: Object.values(DESIGNS).map((d) => ({
            id: d.id, name: d.name, vibe: d.vibe,
            whenToUse: d.whenToUse, tokens: d.tokens, motion: d.motion,
          })),
        });
      }

      // ─ projects ─
      if (route === "GET /api/projects") {
        return sendJson(res, 200, { projects: [...projects.values()] });
      }
      if (route === "POST /api/projects") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const title = String(body.title || "untitled");
        const proj = createProject(title);
        if (body.srt) {
          fs.writeFileSync(path.join(proj.dir, "input/source.srt"), String(body.srt));
        }
        return sendJson(res, 200, proj);
      }

      // /api/projects/{id} / /api/projects/{id}/{op}
      const m = url.pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
      if (m) {
        const projId = m[1];
        const proj = projects.get(projId);
        if (!proj) return sendJson(res, 404, { error: "project not found" });
        const sub = m[2] ?? "";

        if (req.method === "GET" && sub === "") {
          // Return project meta + storyboard (if exists) + file list
          const sbPath = path.join(proj.dir, "output/storyboard.json");
          const storyboard = fs.existsSync(sbPath) ? JSON.parse(fs.readFileSync(sbPath, "utf8")) : null;
          const files = listProjectFiles(proj.dir);
          const projTasks = [...tasks.values()].filter((t) => t.projectId === projId);
          return sendJson(res, 200, { project: proj, storyboard, files, tasks: projTasks });
        }

        if (req.method === "POST" && sub === "/srt") {
          const body = JSON.parse((await readBody(req)) || "{}");
          if (!body.srt) return sendJson(res, 400, { error: "missing srt body" });
          fs.writeFileSync(path.join(proj.dir, "input/source.srt"), String(body.srt));
          return sendJson(res, 200, { ok: true, bytes: Buffer.byteLength(String(body.srt)) });
        }

        if (req.method === "POST" && sub === "/plan") {
          const body = JSON.parse((await readBody(req)) || "{}");
          const srtPath = path.join(proj.dir, "input/source.srt");
          if (!fs.existsSync(srtPath)) return sendJson(res, 400, { error: "no input/source.srt — POST /srt first" });
          const sb = runPlan({
            srtPath,
            outPath: path.join(proj.dir, "output/storyboard.json"),
            designDoc: "design.md",
            assetsDir: path.join(proj.dir, "assets"),
            title: body.title ?? proj.title,
            width: body.width ?? 1920,
            height: body.height ?? 1080,
            fps: body.fps ?? 30,
          });
          return sendJson(res, 200, { storyboard: sb });
        }

        if (req.method === "GET" && sub === "/storyboard") {
          const sbPath = path.join(proj.dir, "output/storyboard.json");
          if (!fs.existsSync(sbPath)) return sendJson(res, 404, { error: "no storyboard yet" });
          return sendJson(res, 200, JSON.parse(fs.readFileSync(sbPath, "utf8")));
        }

        if (req.method === "PUT" && sub === "/storyboard") {
          const body = await readBody(req);
          fs.writeFileSync(path.join(proj.dir, "output/storyboard.json"), ensureDesignDefault(body));
          return sendJson(res, 200, { ok: true });
        }

        // 土味 lint — scan each scene's would-be composition for AI-slop signals.
        if (req.method === "POST" && sub === "/lint") {
          const sbPath = path.join(proj.dir, "output/storyboard.json");
          if (!fs.existsSync(sbPath)) return sendJson(res, 404, { error: "no storyboard yet" });
          const sb = JSON.parse(fs.readFileSync(sbPath, "utf8"));
          return sendJson(res, 200, { scenes: lintStoryboard(sb, proj.dir) });
        }

        // Export an NLE timeline (FCPXML / CMX3600 EDL) of the rendered scenes.
        const expM = sub.match(/^\/export\/(fcpxml|edl)$/);
        if (req.method === "GET" && expM) {
          const sbPath = path.join(proj.dir, "output/storyboard.json");
          if (!fs.existsSync(sbPath)) return sendJson(res, 404, { error: "no storyboard yet" });
          const sb = JSON.parse(fs.readFileSync(sbPath, "utf8"));
          const fmt = expM[1];
          const body = fmt === "fcpxml" ? buildFcpxml(sb, proj.dir) : buildEdl(sb, proj.dir);
          const safe = String(proj.title || "vedio-make").replace(/[^\w一-鿿.-]+/g, "_");
          res.writeHead(200, {
            "Content-Type": fmt === "fcpxml" ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safe + "." + fmt)}`,
          });
          res.end(body);
          return;
        }

        // Enqueue async ops
        const opRoute = sub.match(/^\/(analyze|research|images|matte|tts|bgm|render|storyboard)$/);
        if (req.method === "POST" && opRoute) {
          const op = opRoute[1];
          const body = JSON.parse((await readBody(req)) || "{}");
          const task = makeTask(projId, op);
          // Fire async — don't await
          dispatchTask(task, body).catch(() => {});
          return sendJson(res, 202, task);
        }

        if (req.method === "GET" && sub === "/files") {
          return sendJson(res, 200, { files: listProjectFiles(proj.dir) });
        }
        const fileM = sub.match(/^\/files\/(.+)$/);
        if (req.method === "GET" && fileM) {
          const rel = decodeURIComponent(fileM[1]);
          // Sanitize: ensure no escape from project dir
          const abs = path.resolve(proj.dir, rel);
          if (!abs.startsWith(proj.dir) || !fs.existsSync(abs)) {
            return sendJson(res, 404, { error: "file not found" });
          }
          const ext = path.extname(abs).toLowerCase();
          const mime: Record<string, string> = {
            ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".png": "image/png",
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".json": "application/json",
            ".html": "text/html", ".srt": "application/x-subrip",
          };
          res.writeHead(200, {
            "Content-Type": mime[ext] ?? "application/octet-stream",
            "Content-Length": fs.statSync(abs).size,
          });
          fs.createReadStream(abs).pipe(res);
          return;
        }
      }

      // ─ tasks ─
      if (route === "GET /api/tasks") {
        return sendJson(res, 200, { tasks: [...tasks.values()] });
      }
      const taskM = url.pathname.match(/^\/api\/tasks\/([^/]+)(\/.*)?$/);
      if (taskM) {
        const t = tasks.get(taskM[1]);
        if (!t) return sendJson(res, 404, { error: "task not found" });
        const sub = taskM[2] ?? "";
        if (req.method === "GET" && sub === "") return sendJson(res, 200, t);
        if (req.method === "POST" && sub === "/cancel") {
          t.cancelRequested = true;
          return sendJson(res, 200, { ok: true });
        }
        if (req.method === "GET" && sub === "/events") {
          // SSE stream — every task update emits one event
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const send = (data: Task) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          };
          send(t);
          const onEvent = (updated: Task) => send(updated);
          taskEvents.on(t.id, onEvent);
          req.on("close", () => taskEvents.off(t.id, onEvent));
          return;
        }
      }

      return sendJson(res, 404, { error: `no route for ${route}` });
    } catch (e) {
      console.error("[server] unhandled", e);
      return sendJson(res, 500, { error: (e as Error).message });
    }
  });

  return new Promise((resolve) => {
    server.listen(opts.port, opts.host, () => {
      console.log(`\n┌─ video-pipeline daemon v${VERSION} ──────────────────────────`);
      console.log(`│ listening on http://${opts.host}:${opts.port}`);
      console.log(`│ projects:   ${projectsRoot}`);
      console.log(`│ token:      ${opts.token ? "Bearer " + opts.token.slice(0, 8) + "…" : "(open — no auth)"}`);
      console.log(`│ try:        curl http://${opts.host}:${opts.port}/api/health`);
      console.log(`└──────────────────────────────────────────────────────────────\n`);
      resolve(server);
    });
  });
}

function listProjectFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  walk(path.join(dir, "output"), "output");
  walk(path.join(dir, "assets/generated"), "assets/generated");
  walk(path.join(dir, "assets/matted"), "assets/matted");
  walk(path.join(dir, "input"), "input");
  return out;
}
