#!/usr/bin/env -S npx tsx
/**
 * pipeline CLI — three subcommands:
 *
 *   pipeline plan <subtitle.srt> [--title T] [--out output/storyboard.json]
 *     Parse SRT → write skeleton storyboard.json (method/fallback/reasoning = null)
 *
 *   pipeline storyboard [--in output/storyboard.json] [--out output/storyboard.html]
 *     Render storyboard.json → storyboard.html (human preview with tier badges)
 *
 *   pipeline render [--in output/storyboard.json] [--only N] [--force]
 *     For each scene with a method, generate source and render its MP4.
 *     Stitch all scene MP4s into output/final.mp4 (unless --only).
 *
 * Project root is detected by looking up from cwd for the nearest package.json
 * with "name":"video-pipeline".
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPlan } from "./plan.ts";
import { writeStoryboardHtml } from "./storyboard.ts";
import { runRender } from "./render.ts";
import { runTts } from "./tts.ts";
import { runSay, defaultSayOut } from "./say.ts";
import { runVoice } from "./voice.ts";
import { runBgm } from "./bgm.ts";
import { runAnalyze } from "./analyze.ts";
import { runImages } from "./images.ts";
import { runStickers } from "./stickers.ts";
import { runResearch } from "./research.ts";
import { runMatte } from "./matte.ts";
import { runFetch } from "./fetch-assets.ts";
import { runTranslate } from "./translate.ts";
import { runImport } from "./import-assets.ts";
import { runEdit } from "./edit.ts";
import { startServer } from "./server.ts";
import crypto from "node:crypto";
import { getTts, listProviders } from "./providers/registry.ts";

function findProjectRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(cur, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const data = JSON.parse(fs.readFileSync(pkg, "utf8"));
        if (data.name === "video-pipeline") return cur;
      } catch {}
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.dirname(fileURLToPath(import.meta.url)).replace(/\/src$/, "");
}

/**
 * Read a numeric flag with a default, failing LOUDLY on a non-number instead of
 * letting NaN flow into storyboard.json (where JSON.stringify writes it as null
 * and downstream silently breaks).
 */
function intFlag(
  flags: Record<string, string | boolean>,
  name: string,
  def: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = flags[name];
  if (raw == null || raw === true) return def;
  const v = parseInt(String(raw), 10);
  if (!Number.isFinite(v)) { console.error(`--${name} 需要一个整数,收到 '${raw}'`); process.exit(1); }
  if (opts.min != null && v < opts.min) { console.error(`--${name} 不能小于 ${opts.min}(收到 ${v})`); process.exit(1); }
  if (opts.max != null && v > opts.max) { console.error(`--${name} 不能大于 ${opts.max}(收到 ${v})`); process.exit(1); }
  return v;
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      flags._ = (flags._ as string) ? (flags._ as string) + " " + a : a;
    }
  }
  return flags;
}

function usage(): never {
  const chatProvs = listProviders("chat").join(" | ");
  const ttsProvs = listProviders("tts").join(" | ");
  const imageProvs = listProviders("image").join(" | ");
  const searchProvs = listProviders("search").join(" | ");
  console.error(`Usage:
  pipeline plan <subtitle.srt> [--title T] [--width 1920] [--height 1080] [--fps 30] [--out output/storyboard.json]
  pipeline analyze   [--in JSON] [--provider <${chatProvs}>] [--fill-only]
  pipeline edit      "<instruction>" [--in JSON] [--provider <${chatProvs}>] [--dry-run] [--yes]
  pipeline approve   [--in JSON]   (mark stages.approved = true; render gates on this)
  pipeline storyboard [--in JSON] [--out HTML]
  pipeline research  [--in JSON] [--provider <${searchProvs}>] [--chat-provider <${chatProvs}>] [--force]
  pipeline images    [--in JSON] [--provider <${imageProvs}>] [--chat-provider <${chatProvs}>] [--aspect 16:9] [--scene N] [--n 1-3] [--raw] [--force]
  pipeline stickers  --prompts <file> | --prompt "<subject>"  [--provider <${imageProvs}>] [--aspect 3:4] [--in JSON] [--force]
                     (白底单体生图 → u2net 抠像 → assets/stickers/*.matte.png,喂 hf-sticker-pop)
  pipeline tts       [--in JSON] [--provider <${ttsProvs}>] [--voice <id>] [--speed 1.0] [--force]
  pipeline say       "<text>" | --file F  [--voice <id>] [--speed 1.0] [--emotion happy] [--out mp3] [--provider <${ttsProvs}>]
                     (read ANY text aloud → one mp3; free Edge voices need no key, minimax:* are paid)
  pipeline voice     clone <audio> --label "名字"  |  list  |  keepalive <id>  |  rm <id>
                     (MiniMax voice cloning; cloned voices are usable as minimax:user_<hex>)
  pipeline bgm       [--in JSON] [--prompt "free-form"] [--force]
  pipeline voices    [--provider <${ttsProvs}>]   (list available voice ids; grouped: edge/minimax/clone)
  pipeline matte     [<input.png>] [--asset <rel>] [--all-generated] [--auto] [--scene N] [--force]
                     (--auto: matte every scene the analyzer flagged needsMatting)
  pipeline fetch     <query> [--provider pexels|unsplash|pixabay|51yuansu|envato] [--type photo|video|psd|...] [--orientation] [--count N] [--scene N]
  pipeline import    <folder|file> [--scene N] [--pattern '*.psd'] [--foreground] [--symlink]
  pipeline translate <lang>  [--in JSON] [--source <lang>] [--provider] [--force]
  pipeline render    [--in JSON] [--only N] [--force] [--workers 2] [--stitch] [--estimate]
  pipeline validate  [--in JSON]   (渲染前结构校验 + 幻灯片风险评分;有致命问题退出码 1)
  pipeline review    [--in JSON]   (渲染后自检 final.mp4:ffprobe + 抽帧 + 音频;写 output/qa-report.json)
  pipeline cost      [--in JSON] [--tts p] [--image p] [--music p]   (数量级成本预估;免费 provider 计 $0)
  pipeline serve     [--port 8766] [--host 127.0.0.1] [--token <bearer>] [--projects ./projects]
`);
  process.exit(1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();

  const root = findProjectRoot(process.cwd());
  const catalogPath = path.join(root, "methods", "catalog.json");

  if (cmd === "plan") {
    const positional = rest.filter((a) => !a.startsWith("--"));
    const flags = parseFlags(rest);
    const srtArg = positional[0];
    if (!srtArg) usage();
    const srtPath = path.resolve(process.cwd(), srtArg);
    if (!fs.existsSync(srtPath)) {
      console.error(`Subtitle file not found: ${srtPath}`);
      process.exit(1);
    }
    const outPath = path.resolve(root, (flags.out as string) || "output/storyboard.json");
    const title = (flags.title as string) || path.basename(srtPath, path.extname(srtPath));
    const designDoc = (flags.design as string) || "design.md";
    const assetsDir = path.resolve(root, "assets");
    const width = intFlag(flags, "width", 1920, { min: 16, max: 8192 });
    const height = intFlag(flags, "height", 1080, { min: 16, max: 8192 });
    const fps = intFlag(flags, "fps", 30, { min: 1, max: 120 });

    const sb = runPlan({ srtPath, outPath, designDoc, assetsDir, title, width, height, fps, force: Boolean(flags.force) });
    console.log(`✓ Parsed ${sb.scenes.length} cues → ${path.relative(process.cwd(), outPath)}`);
    console.log(`  Asset pool: ${sb.assetPool.length} file(s)`);
    console.log(`  Next step:  Claude fills method/fallback/reasoning for each scene, then run:`);
    console.log(`    pipeline storyboard`);
    return;
  }

  if (cmd === "storyboard") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    const outPath = path.resolve(root, (flags.out as string) || "output/storyboard.html");
    if (!fs.existsSync(inPath)) {
      console.error(`Storyboard JSON not found: ${inPath}`);
      console.error(`Run 'pipeline plan <subtitle.srt>' first.`);
      process.exit(1);
    }
    writeStoryboardHtml(inPath, catalogPath, outPath);
    console.log(`✓ Wrote ${path.relative(process.cwd(), outPath)}`);
    console.log(`  Open in browser:  file://${outPath}`);
    return;
  }

  if (cmd === "analyze") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    const designPath = path.resolve(root, "design.md");
    const assetsDir = path.resolve(root, "assets");
    const fillOnly = Boolean(flags["fill-only"]);
    const provider = flags.provider as string | undefined;
    if (!fs.existsSync(inPath)) {
      console.error(`Storyboard JSON not found: ${inPath}`);
      console.error(`Run 'pipeline plan <subtitle.srt>' first.`);
      process.exit(1);
    }
    await runAnalyze({
      storyboardPath: inPath,
      catalogPath,
      designPath,
      assetsDir,
      projectRoot: root,
      fillOnly,
      provider,
    });
    console.log(`\n  Next: pipeline storyboard  (preview HTML), then 'pipeline render' to render.`);
    return;
  }

  if (cmd === "edit") {
    const positional = rest.filter((a) => !a.startsWith("--"));
    const flags = parseFlags(rest);
    const instruction = positional.join(" ").trim();
    if (!instruction) { console.error(`edit: instruction required (in quotes)`); process.exit(1); }
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    if (!fs.existsSync(inPath)) { console.error(`Storyboard JSON not found: ${inPath}`); process.exit(1); }
    await runEdit({
      instruction,
      storyboardPath: inPath,
      catalogPath,
      provider: flags.provider as string | undefined,
      dryRun: Boolean(flags["dry-run"]),
      yes: Boolean(flags.yes),
    });
    return;
  }

  if (cmd === "approve") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    if (!fs.existsSync(inPath)) { console.error(`Storyboard JSON not found: ${inPath}`); process.exit(1); }
    const sb = JSON.parse(fs.readFileSync(inPath, "utf8"));
    sb.stages = { ...(sb.stages ?? {}), approved: true };
    fs.writeFileSync(inPath, JSON.stringify(sb, null, 2));
    // Lock the delivery promise so the post-render review can catch any silent
    // downgrade (dropped narration, removed scene, design swap) after this point.
    const { lockPromise } = await import("./promise.ts");
    const promise = lockPromise(sb, path.dirname(inPath));
    console.log(`✓ Storyboard approved. 'pipeline render' will now run without --force.`);
    console.log(`  已锁定成片承诺:${promise.sceneCount} 镜头 · ${promise.durationSec}s · 配音=${promise.audio.voice ? "有" : "无"} · 配乐=${promise.audio.bgm ? "有" : "无"}`);
    return;
  }

  if (cmd === "research") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    const force = Boolean(flags.force);
    const searchProvider = flags.provider as string | undefined;
    const chatProvider = flags["chat-provider"] as string | undefined;
    if (!fs.existsSync(inPath)) { console.error(`Storyboard JSON not found: ${inPath}`); process.exit(1); }
    await runResearch({ storyboardPath: inPath, force, searchProvider, chatProvider });
    return;
  }

  if (cmd === "images") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    const assetsDir = path.resolve(root, "assets");
    const force = Boolean(flags.force);
    const rawPrompts = Boolean(flags.raw);
    const provider = flags.provider as string | undefined;
    const chatProvider = flags["chat-provider"] as string | undefined;
    const aspect = (flags.aspect as string | undefined) as
      | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | undefined;
    const onlyIndices = flags.scene ? [parseInt(flags.scene as string, 10)] : undefined;
    if (!fs.existsSync(inPath)) { console.error(`Storyboard JSON not found: ${inPath}`); process.exit(1); }
    const candidates = intFlag(flags, "n", 1, { min: 1, max: 9 });
    await runImages({
      storyboardPath: inPath,
      assetsDir,
      projectRoot: root,
      force,
      provider,
      chatProvider,
      aspectRatio: aspect,
      onlyIndices,
      rawPrompts,
      candidates,
    });
    return;
  }

  if (cmd === "stickers") {
    const flags = parseFlags(rest);
    const provider = (flags.provider as string) || "mytokk";
    const aspect = flags.aspect as "1:1" | "3:4" | "9:16" | "16:9" | "4:3" | undefined;
    const force = Boolean(flags.force);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    let prompts: string[] = [];
    if (typeof flags.prompts === "string") {
      const pf = path.resolve(root, flags.prompts);
      if (!fs.existsSync(pf)) { console.error(`prompts file not found: ${pf}`); process.exit(1); }
      prompts = fs.readFileSync(pf, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((l) => l && !l.startsWith("#"));
    } else if (typeof flags.prompt === "string") {
      prompts = [flags.prompt];
    } else if (typeof flags._ === "string") {
      prompts = [flags._];
    }
    if (!prompts.length) {
      console.error(`pipeline stickers: need --prompts <file> (one subject per line) or --prompt "<subject>"`);
      process.exit(1);
    }
    await runStickers({
      prompts, projectRoot: root, provider, aspectRatio: aspect, force,
      storyboardPath: fs.existsSync(inPath) ? inPath : undefined,
    });
    return;
  }

  if (cmd === "voices") {
    const flags = parseFlags(rest);
    const provider = flags.provider as string | undefined;
    const ttsClient = getTts(provider);
    // The router exposes grouped voices (edge / minimax / clone); others are flat.
    const grouped = (ttsClient as any).groupedVoices?.();
    if (grouped) {
      const GROUPS: Array<[string, string]> = [
        ["edge", "免费 · Edge"],
        ["minimax", "付费 · MiniMax 系统"],
        ["minimax_clone", "我的克隆"],
      ];
      console.log(`Available voices (provider '${ttsClient.id}'):`);
      for (const [key, title] of GROUPS) {
        const items = grouped.filter((v: any) => v.group === key);
        if (!items.length) continue;
        console.log(`\n  [${title}]`);
        for (const v of items) {
          const g = v.gender ? `${v.gender.padEnd(6)}` : "      ";
          console.log(`    ${v.id.padEnd(42)} ${g}  ${v.label}`);
        }
      }
      console.log(`\n  用法: pipeline say "文本" --voice <id>   或   pipeline tts --voice <id>`);
      return;
    }
    console.log(`Available voices for provider '${ttsClient.id}':\n`);
    for (const v of ttsClient.voices()) {
      const tags = v.tags?.length ? `  (${v.tags.join(", ")})` : "";
      const g = v.gender ? `${v.gender.padEnd(6)}` : "      ";
      console.log(`  ${v.id.padEnd(40)} ${g}  ${v.label}${tags}`);
    }
    return;
  }

  if (cmd === "tts") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    const voiceDir = path.resolve(root, "output/voice");
    const trackPath = path.resolve(root, "output/voice-track.json");
    const voiceId = (flags.voice as string) || "presenter_male";
    const speed = flags.speed ? parseFloat(flags.speed as string) : 1.0;
    const force = Boolean(flags.force);
    const provider = flags.provider as string | undefined;
    if (!fs.existsSync(inPath)) {
      console.error(`Storyboard JSON not found: ${inPath}`);
      process.exit(1);
    }
    await runTts({ storyboardPath: inPath, voiceDir, trackPath, projectRoot: root, voiceId, speed, force, provider });
    return;
  }

  if (cmd === "say") {
    const positional = rest.filter((a) => !a.startsWith("--"));
    const flags = parseFlags(rest);
    let text = positional.join(" ").trim();
    if (flags.file) {
      const fp = path.resolve(process.cwd(), flags.file as string);
      if (!fs.existsSync(fp)) { console.error(`say: file not found: ${fp}`); process.exit(1); }
      text = fs.readFileSync(fp, "utf8");
    }
    if (!text.trim()) { console.error(`say: text required (quote it) or pass --file <path>`); process.exit(1); }
    const voiceId = (flags.voice as string) || "zh-CN-XiaoxiaoNeural";
    const speed = flags.speed ? parseFloat(flags.speed as string) : 1.0;
    const emotion = flags.emotion as string | undefined;
    const provider = flags.provider as string | undefined;
    const outPath = flags.out
      ? path.resolve(process.cwd(), flags.out as string)
      : defaultSayOut(root, text, voiceId);
    await runSay({ text, outPath, voiceId, speed, emotion, provider });
    return;
  }

  if (cmd === "voice") {
    const positional = rest.filter((a) => !a.startsWith("--"));
    const flags = parseFlags(rest);
    const sub = positional[0];
    if (!sub) { console.error(`voice: subcommand required — clone | list | keepalive | rm`); process.exit(1); }
    await runVoice(sub, positional.slice(1), flags);
    return;
  }

  if (cmd === "bgm") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    const outPath = path.resolve(root, "output/bgm.mp3");
    const force = Boolean(flags.force);
    const promptOverride = (flags.prompt as string) || undefined;
    const provider = flags.provider as string | undefined;
    if (!fs.existsSync(inPath)) {
      console.error(`Storyboard JSON not found: ${inPath}`);
      process.exit(1);
    }
    await runBgm({ storyboardPath: inPath, outPath, force, promptOverride, provider });
    return;
  }

  if (cmd === "serve") {
    const flags = parseFlags(rest);
    const port = intFlag(flags, "port", parseInt(process.env.PIPELINE_PORT || "8766", 10) || 8766, { min: 1, max: 65535 });
    const host = (flags.host as string) || "127.0.0.1";
    const projectsDir = path.resolve(root, (flags.projects as string) || "projects");
    let token = (flags.token as string) || process.env.PIPELINE_TOKEN || "";
    if (!token && !flags["no-auth"]) {
      token = crypto.randomBytes(24).toString("base64url");
      console.log(`[serve] no PIPELINE_TOKEN set; generated: ${token}`);
    }
    fs.mkdirSync(projectsDir, { recursive: true });
    await startServer({ port, host, token, projectsDir });
    return; // server runs forever
  }

  if (cmd === "translate") {
    const positional = rest.filter((a) => !a.startsWith("--"));
    const flags = parseFlags(rest);
    const targetLang = positional[0];
    if (!targetLang) { console.error(`translate: target lang required (e.g. en, ja, zh-tw)`); process.exit(1); }
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    if (!fs.existsSync(inPath)) { console.error(`Storyboard JSON not found: ${inPath}`); process.exit(1); }
    await runTranslate({
      storyboardPath: inPath,
      outputDir: path.resolve(root, "output"),
      targetLang,
      sourceLang: flags.source as string | undefined,
      provider: flags.provider as string | undefined,
      force: Boolean(flags.force),
    });
    return;
  }

  if (cmd === "import") {
    const positional = rest.filter((a) => !a.startsWith("--"));
    const flags = parseFlags(rest);
    const source = positional[0];
    if (!source) { console.error(`import: source folder or file required`); process.exit(1); }
    const sceneIndex = flags.scene ? parseInt(flags.scene as string, 10) : undefined;
    const storyboardPath = path.resolve(root, "output/storyboard.json");
    await runImport({
      source,
      projectRoot: root,
      storyboardPath: fs.existsSync(storyboardPath) ? storyboardPath : undefined,
      pattern: flags.pattern as string | undefined,
      sceneIndex,
      asForeground: Boolean(flags.foreground),
      symlink: Boolean(flags.symlink),
    });
    return;
  }

  if (cmd === "fetch") {
    const positional = rest.filter((a) => !a.startsWith("--"));
    const flags = parseFlags(rest);
    const query = positional.join(" ").trim();
    if (!query) { console.error(`fetch: query required`); process.exit(1); }
    const provider = flags.provider as string | undefined;
    const type = (flags.type as string | undefined) as any;
    const orientation = (flags.orientation as string | undefined) as any;
    const count = flags.count ? parseInt(flags.count as string, 10) : 1;
    const sceneIndex = flags.scene ? parseInt(flags.scene as string, 10) : undefined;
    const storyboardPath = path.resolve(root, "output/storyboard.json");
    await runFetch({
      query, provider, type, orientation, count,
      sceneIndex,
      projectRoot: root,
      storyboardPath: fs.existsSync(storyboardPath) ? storyboardPath : undefined,
    });
    return;
  }

  if (cmd === "matte") {
    const positional = rest.filter((a) => !a.startsWith("--"));
    const flags = parseFlags(rest);
    const inputPath = positional[0];
    const assetPath = flags.asset as string | undefined;
    const allGenerated = Boolean(flags["all-generated"]);
    const auto = Boolean(flags.auto);
    const force = Boolean(flags.force);
    const sceneIndex = flags.scene ? parseInt(flags.scene as string, 10) : undefined;
    const device = (flags.device as string) || "auto";
    const storyboardPath = path.resolve(root, "output/storyboard.json");
    await runMatte({
      inputPath,
      assetPath,
      allGenerated,
      auto,
      sceneIndex,
      projectRoot: root,
      storyboardPath: fs.existsSync(storyboardPath) ? storyboardPath : undefined,
      force,
      device,
    });
    return;
  }

  if (cmd === "render") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    const outputDir = path.resolve(root, "output");
    const only = flags.only != null ? parseInt(String(flags.only), 10) : null;
    if (only !== null && !Number.isInteger(only)) {
      console.error(`render: --only 需要一个整数镜号,收到 '${flags.only}'`); process.exit(1);
    }
    const force = Boolean(flags.force);
    const stitchOnly = Boolean(flags.stitch);
    const workers = flags.workers != null ? parseInt(String(flags.workers), 10) : 1;
    if (!Number.isInteger(workers) || workers < 1) {
      console.error(`render: --workers 需要 ≥1 的整数,收到 '${flags.workers}'`); process.exit(1);
    }
    if (!fs.existsSync(inPath)) {
      console.error(`Storyboard JSON not found: ${inPath}`);
      process.exit(1);
    }
    if (flags.estimate) {
      // Dry-run: show the cost estimate and DON'T render.
      const { estimateStoryboard, summarizeCost } = await import("./cost.ts");
      const sb = JSON.parse(fs.readFileSync(inPath, "utf8"));
      const est = estimateStoryboard(sb, { withMusic: Boolean(flags.music) });
      console.log(summarizeCost(est));
      for (const li of est.lineItems) console.log(`  · ${li.category} [${li.provider}] ${li.quantity}${li.unit} → $${li.totalUsd.toFixed(2)}  (${li.basis})`);
      console.log(`\n${est.disclaimer}`);
      return;
    }
    await runRender({ storyboardPath: inPath, outputDir, projectRoot: root, force, only, workers, stitchOnly });
    return;
  }

  if (cmd === "cost") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    if (!fs.existsSync(inPath)) { console.error(`Storyboard JSON not found: ${inPath}`); process.exit(1); }
    const { estimateStoryboard, summarizeCost } = await import("./cost.ts");
    const sb = JSON.parse(fs.readFileSync(inPath, "utf8"));
    const est = estimateStoryboard(sb, {
      ttsProvider: flags.tts as string | undefined,
      imageProvider: flags.image as string | undefined,
      musicProvider: flags.music as string | undefined,
      withMusic: Boolean(flags.music),
    });
    console.log(summarizeCost(est));
    for (const li of est.lineItems) console.log(`  · ${li.category} [${li.provider}] ${li.quantity}${li.unit} → $${li.totalUsd.toFixed(2)}  (${li.basis})`);
    console.log(`\n${est.disclaimer}`);
    return;
  }

  if (cmd === "validate") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    if (!fs.existsSync(inPath)) { console.error(`Storyboard JSON not found: ${inPath}`); process.exit(1); }
    const { validateStoryboard, splitFindings } = await import("./validate.ts");
    const { scoreSlideshowRisk } = await import("./slideshow.ts");
    const sb = JSON.parse(fs.readFileSync(inPath, "utf8"));
    const { errors, warnings } = splitFindings(validateStoryboard(sb, root, null));
    for (const w of warnings) console.warn(`⚠ ${w.msg}`);
    for (const e of errors) console.error(`✗ ${e.msg}`);
    const risk = scoreSlideshowRisk(sb, root);
    console.log(`\n幻灯片风险 ${risk.average}(${risk.verdict})`);
    for (const [k, d] of Object.entries(risk.dimensions)) console.log(`  · ${k} [${d.score.toFixed(1)}] ${d.reason}`);
    console.log(errors.length ? `\n✗ 校验未通过:${errors.length} 个致命问题` : `\n✓ 结构校验通过${warnings.length ? `(${warnings.length} 条提醒)` : ""}`);
    process.exit(errors.length ? 1 : 0);
  }

  if (cmd === "review") {
    const flags = parseFlags(rest);
    const inPath = path.resolve(root, (flags.in as string) || "output/storyboard.json");
    if (!fs.existsSync(inPath)) { console.error(`Storyboard JSON not found: ${inPath}`); process.exit(1); }
    // The storyboard lives in output/, so final.mp4 + qa/ are siblings of it.
    const outputDir = path.dirname(inPath);
    const projectRoot = path.dirname(outputDir);
    const { reviewFinal, summarizeReport } = await import("./review.ts");
    const sb = JSON.parse(fs.readFileSync(inPath, "utf8"));
    const qa = await reviewFinal(sb, outputDir, projectRoot);
    console.log(summarizeReport(qa));
    for (const f of qa.findings) console.log(`  ${f.level === "error" ? "✗" : f.level === "warn" ? "⚠" : "·"} ${f.msg}`);
    console.log(`\n报告: output/qa-report.json · 抽样帧: output/qa/`);
    process.exit(qa.status === "fail" ? 1 : 0);
  }

  console.error(`Unknown command: ${cmd}`);
  usage();
}

main().catch((e) => {
  // Clean one-line errors for users; full stack only with PIPELINE_DEBUG=1.
  // (Edge TTS is a soft dependency — its handshake can fail on restricted
  //  networks; surface a hint instead of an undici stack dump.)
  const msg = (e as Error)?.message || String(e);
  if (process.env.PIPELINE_DEBUG) {
    console.error(e);
  } else {
    console.error(`✗ ${msg}`);
    if (/Edge 配音组件|Edge TTS/.test(msg)) {
      console.error(`  提示: Edge 免费引擎在当前网络握手失败,改用 MiniMax 付费音色(--voice minimax:<id>,如 minimax:female-shaonv),或检查网络/代理。`);
    }
  }
  process.exit(1);
});
