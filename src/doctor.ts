/**
 * `pipeline doctor` — one pass over everything a render silently depends on, so a broken
 * environment shows up before a 20-minute render instead of halfway through it:
 * ffmpeg + the filters the pipeline uses, render-engine caches, Edge TTS / provider reachability,
 * and which provider keys are configured. Keys are reported as present/absent only, never printed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasProviderKey, loadProviderConfig } from "./providers/shared.ts";
import { edgeTts } from "./providers/edge/tts.ts";
import { HYPERFRAMES_PKG } from "./render.ts";

export type Status = "ok" | "warn" | "fail";
export interface Check { group: string; name: string; status: Status; detail: string }

/** Filters render/review cannot work without vs ones that only gate an optional feature. */
const REQUIRED_FILTERS = ["xfade", "amix", "adelay", "apad", "afade", "volumedetect", "signalstats", "scale", "fps"];
const OPTIONAL_FILTERS: Record<string, string> = {
  subtitles: "字幕烧录不可用(需 libass),只能出侧挂 final.srt",
  drawtext: "画面压字不可用(需 freetype/drawtext)",
};

/** Providers that need a key, and the host to probe when no base_url is configured. */
export const KEYED_PROVIDERS: Record<string, string> = {
  minimax: "https://api.minimaxi.com",
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com",
  mytokk: "https://mytokk.com",
  tavily: "https://api.tavily.com",
  pexels: "https://api.pexels.com",
  pixabay: "https://pixabay.com",
  unsplash: "https://api.unsplash.com",
};

/** Filter names from `ffmpeg -filters` output (lines like " TS xfade  VV->V  Cross fade …"). */
export function parseFfmpegFilters(listing: string): Set<string> {
  const names = new Set<string>();
  for (const line of listing.split("\n")) {
    const m = line.match(/^\s[A-Z.|]{2,3}\s+(\w+)\s+\S+->\S+/);
    if (m) names.add(m[1]);
  }
  return names;
}

export function ffmpegChecks(listing: string | null): Check[] {
  if (listing == null) return [{ group: "ffmpeg", name: "ffmpeg", status: "fail", detail: "找不到 ffmpeg(拼接/混音/自检都靠它)" }];
  const have = parseFfmpegFilters(listing);
  const missing = REQUIRED_FILTERS.filter((f) => !have.has(f));
  const out: Check[] = [{
    group: "ffmpeg", name: "必需滤镜", status: missing.length ? "fail" : "ok",
    detail: missing.length ? `缺 ${missing.join(", ")}` : REQUIRED_FILTERS.join(" "),
  }];
  for (const [f, why] of Object.entries(OPTIONAL_FILTERS)) {
    out.push({ group: "ffmpeg", name: f, status: have.has(f) ? "ok" : "warn", detail: have.has(f) ? "可用" : why });
  }
  return out;
}

export function keyChecks(has: (id: string) => boolean, ids = Object.keys(KEYED_PROVIDERS)): Check[] {
  return ids.map((id) => ({
    group: "key", name: id, status: has(id) ? "ok" : "warn",
    detail: has(id) ? "已配置" : "未配置(用到它的功能不可用,零 key 路径不受影响)",
  }));
}

/** First npx-cached copy of `pkg@version` (e.g. hyperframes@0.6.7), if any. */
export function findNpxPackage(pkgSpec: string, npxRoot = path.join(os.homedir(), ".npm", "_npx")): string | null {
  const [name, version] = pkgSpec.split("@");
  if (!fs.existsSync(npxRoot)) return null;
  for (const d of fs.readdirSync(npxRoot)) {
    const pj = path.join(npxRoot, d, "node_modules", name, "package.json");
    try {
      if (JSON.parse(fs.readFileSync(pj, "utf8")).version === version) return path.dirname(pj);
    } catch {}
  }
  return null;
}

export function engineChecks(home = os.homedir()): Check[] {
  const hf = findNpxPackage(HYPERFRAMES_PKG, path.join(home, ".npm", "_npx"));
  const chrome = ["chrome-headless-shell", "chrome"].some((d) => fs.existsSync(path.join(home, ".cache", "puppeteer", d)));
  return [
    { group: "引擎", name: HYPERFRAMES_PKG, status: hf ? "ok" : "warn", detail: hf ? "已缓存" : "未缓存:首次渲染会经 npx 下载(约 170 MB)" },
    { group: "引擎", name: "无头 Chrome", status: chrome ? "ok" : "warn", detail: chrome ? "已缓存" : "未缓存:首次渲染会下载(约 530 MB)" },
  ];
}

async function reachable(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    return true; // any HTTP answer (even 401/404) means the host is reachable
  } catch {
    return false;
  }
}

export async function networkChecks(has: (id: string) => boolean = hasProviderKey): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const mp3 = await Promise.race([
      edgeTts.tts({ text: "测试。" }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("超时")), 20000)),
    ]);
    out.push({ group: "连通", name: "Edge 免费配音", status: "ok", detail: `可用(${mp3.length} B)` });
  } catch (e) {
    out.push({ group: "连通", name: "Edge 免费配音", status: "warn", detail: `不可用:${String((e as Error).message).slice(0, 60)};macOS 上会回退到系统音色` });
  }
  for (const id of Object.keys(KEYED_PROVIDERS).filter(has)) {
    let base = KEYED_PROVIDERS[id];
    try { base = loadProviderConfig(id).base_url || base; } catch {}
    const ok = await reachable(base);
    // Unreachable provider = its features fail, but rendering itself does not → warn, not fail.
    out.push({ group: "连通", name: id, status: ok ? "ok" : "warn", detail: ok ? `${new URL(base).host} 可达` : `${new URL(base).host} 连不上(用到它的功能会失败)` });
  }
  return out;
}

export function nodeCheck(version = process.versions.node): Check {
  const major = Number(version.split(".")[0]);
  return { group: "运行时", name: "Node", status: major >= 18 ? "ok" : "fail", detail: `v${version}${major >= 18 ? "" : "(需要 ≥ 18)"}` };
}

export function summarize(checks: Check[]): { exitCode: number; text: string } {
  const icon: Record<Status, string> = { ok: "✓", warn: "⚠", fail: "✗" };
  const lines = checks.map((c) => `${icon[c.status]} [${c.group}] ${c.name} — ${c.detail}`);
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  lines.push("", fails ? `✗ ${fails} 项会让渲染失败,${warns} 项提醒` : `✓ 可以渲染(${warns} 项提醒)`);
  return { exitCode: fails ? 1 : 0, text: lines.join("\n") };
}

export async function runDoctor(opts: { network?: boolean } = {}): Promise<Check[]> {
  const ff = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
  const checks: Check[] = [nodeCheck(), ...ffmpegChecks(ff.error || ff.status !== 0 ? null : ff.stdout), ...engineChecks(), ...keyChecks(hasProviderKey)];
  if (opts.network !== false) checks.push(...(await networkChecks()));
  return checks;
}
