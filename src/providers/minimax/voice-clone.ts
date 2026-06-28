/**
 * MiniMax voice cloning — upload / clone / 168-hour keepalive + local store.
 *
 * TypeScript port of Restate's voice_clone.py (same contract, same gotchas).
 * Cloned voices reuse the MiniMax T2A channel: their ids are namespaced
 * `minimax:user_<hex>` so the prefix router (providers/voice-router.ts) sends
 * them down the existing MiniMax path with zero extra routing.
 *
 * 168-hour rule: a freshly cloned voice is TEMPORARY for 168h; the first
 * successful T2A within that window flips it permanent. We call touchVoice()
 * after every successful synth, so any voice the user actually uses survives
 * for free. `keepaliveVoice()` is the manual fallback.
 *
 * Local store `~/.video-toolkit/cloned_voices.json` is the SINGLE SOURCE OF
 * TRUTH — MiniMax has no "list my clones" endpoint, so we track them ourselves.
 * Atomic write (tmp + rename) + chmod 600 (voice_ids are sensitive RPC tokens).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { loadProviderConfig, hasProviderKey } from "../shared.ts";

export const CLONED_VOICES_PATH = path.join(os.homedir(), ".video-toolkit", "cloned_voices.json");
export const KEEPALIVE_WINDOW_SEC = 168 * 3600;
const VOICE_ID_PREFIX = "user_";

export interface ClonedVoice {
  voice_id: string;       // MiniMax voice_id, e.g. "user_a1b2c3d4e5f6g7h8"
  label: string;          // human-readable; what a picker shows
  created_at: number;     // epoch seconds — anchors the 168h window
  last_used_at: number;   // epoch seconds — refreshed on every T2A use
  permanent: boolean;     // true once a successful T2A has flipped it
  sample_filename: string;// original uploaded filename (display only)
}

export class CloneError extends Error {
  httpStatus: number;
  details: string;
  constructor(message: string, httpStatus = 502, details = "") {
    super(message);
    this.name = "CloneError";
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

// ── local store ──────────────────────────────────────────────────────────
function load(): ClonedVoice[] {
  if (!fs.existsSync(CLONED_VOICES_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(CLONED_VOICES_PATH, "utf8"));
    return (raw.voices ?? []).map((d: any) => ({
      voice_id: String(d.voice_id),
      label: String(d.label ?? ""),
      created_at: Number(d.created_at ?? 0),
      last_used_at: Number(d.last_used_at ?? 0),
      permanent: Boolean(d.permanent ?? false),
      sample_filename: String(d.sample_filename ?? ""),
    }));
  } catch {
    return [];
  }
}

function save(voices: ClonedVoice[]): void {
  fs.mkdirSync(path.dirname(CLONED_VOICES_PATH), { recursive: true });
  const tmp = CLONED_VOICES_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ voices }, null, 2), "utf8");
  try {
    fs.renameSync(tmp, CLONED_VOICES_PATH);
  } catch {
    // Windows can refuse rename-over-existing (EPERM/EEXIST) — fall back to copy.
    fs.copyFileSync(tmp, CLONED_VOICES_PATH);
    try { fs.unlinkSync(tmp); } catch {}
  }
  try { fs.chmodSync(CLONED_VOICES_PATH, 0o600); } catch {} // no-op on Windows
}

export function listVoices(): ClonedVoice[] {
  return load().sort((a, b) => b.created_at - a.created_at);
}
export function getVoice(voiceId: string): ClonedVoice | undefined {
  return load().find((v) => v.voice_id === voiceId);
}
export function addVoice(voice: ClonedVoice): void {
  const voices = load().filter((v) => v.voice_id !== voice.voice_id);
  voices.push(voice);
  save(voices);
}
export function removeVoice(voiceId: string): boolean {
  const voices = load();
  const next = voices.filter((v) => v.voice_id !== voiceId);
  if (next.length === voices.length) return false;
  save(next);
  return true;
}
/** Bump last_used_at + flip permanent. No-op if not tracked locally. */
export function touchVoice(voiceId: string): void {
  const voices = load();
  const v = voices.find((x) => x.voice_id === voiceId);
  if (!v) return;
  v.last_used_at = Math.floor(Date.now() / 1000);
  v.permanent = true;
  save(voices);
}
export function voiceStatus(v: ClonedVoice): { state: "permanent" | "trial" | "expired"; remainingSec: number | null } {
  if (v.permanent) return { state: "permanent", remainingSec: null };
  const elapsed = Date.now() / 1000 - v.created_at;
  const remaining = KEEPALIVE_WINDOW_SEC - elapsed;
  if (remaining <= 0) return { state: "expired", remainingSec: 0 };
  return { state: "trial", remainingSec: Math.floor(remaining) };
}

function generateVoiceId(): string {
  // 8 random bytes → 16 hex + "user_" prefix = 21 chars (lowercase/digits/_, ≥8).
  return VOICE_ID_PREFIX + crypto.randomBytes(8).toString("hex");
}

// ── MiniMax credentials + HTTPS guard ────────────────────────────────────
function minimaxCreds(): { baseUrl: string; apiKey: string } {
  if (!hasProviderKey("minimax")) {
    throw new CloneError(
      "MiniMax 音色克隆需要 MiniMax API key。先在 providers.json / 环境变量 MINIMAX_API_KEY 配置后重试。",
      400,
    );
  }
  const cfg = loadProviderConfig("minimax");
  const baseUrl = (cfg.base_url || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new CloneError("MiniMax base_url 未配置(providers.json 里 minimax.base_url)。", 400);
  }
  if (!/^https:/i.test(baseUrl) && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(baseUrl)) {
    throw new CloneError(`MiniMax base_url 必须是 https(当前 '${baseUrl}')——明文会泄露 API key。`, 400);
  }
  return { baseUrl, apiKey: cfg.api_key };
}

// ── MiniMax HTTP calls ───────────────────────────────────────────────────
/**
 * Upload to {base}/files/upload, return file_id VERBATIM (do NOT cast).
 * MiniMax documents file_id as int; casting it to string trips a silent
 * `2013 invalid params` downstream with no hint which field was wrong.
 */
export async function uploadSample(filePath: string, purpose = "voice_clone"): Promise<unknown> {
  const { baseUrl, apiKey } = minimaxCreds();
  if (!fs.existsSync(filePath)) throw new CloneError(`样本文件不存在:${filePath}`, 400);
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/octet-stream" }), path.basename(filePath));
  form.append("purpose", purpose);

  let r: Response;
  try {
    r = await fetch(`${baseUrl}/files/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new CloneError(`上传样本失败:网络错误 ${(e as Error).message}`, 502);
  }
  if (!r.ok) throw new CloneError(`上传样本失败:HTTP ${r.status}`, 502, (await r.text()).slice(0, 300));
  const j: any = await r.json();
  if ((j?.base_resp?.status_code ?? 0) !== 0) {
    throw new CloneError(`MiniMax 拒绝样本:${j?.base_resp?.status_msg ?? "未知错误"}`, 502, JSON.stringify(j).slice(0, 500));
  }
  const fileId = j?.file?.file_id;
  if (fileId === undefined || fileId === null || fileId === "") {
    throw new CloneError("上传成功但响应里找不到 file_id", 502, JSON.stringify(j).slice(0, 500));
  }
  return fileId; // verbatim — preserve type
}

/**
 * POST {base}/voice_clone with file_id + a CALLER-generated voice_id (MiniMax
 * does not generate one). `text` (preview) looks optional but omitting it has
 * tripped 2013 on some API revisions — keep a benign default. 1004 (already
 * exists) is treated as success (idempotent re-clone).
 */
export async function submitClone(
  fileId: unknown,
  voiceId?: string,
  model = "speech-02-hd",
  previewText = "你好,这是用来验证克隆效果的一段话。",
): Promise<string> {
  const { baseUrl, apiKey } = minimaxCreds();
  const vid = voiceId || generateVoiceId();
  const payload: Record<string, unknown> = { file_id: fileId, voice_id: vid, model };
  if (previewText.trim()) payload.text = previewText.trim();

  let r: Response;
  try {
    r = await fetch(`${baseUrl}/voice_clone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (e) {
    throw new CloneError(`克隆失败:网络错误 ${(e as Error).message}`, 502);
  }
  if (!r.ok) throw new CloneError(`克隆失败:HTTP ${r.status}`, 502, (await r.text()).slice(0, 300));
  const j: any = await r.json();
  const code = j?.base_resp?.status_code ?? 0;
  if (code !== 0) {
    if (code === 1004) return vid; // already exists → idempotent success
    throw new CloneError(`MiniMax 克隆失败:${j?.base_resp?.status_msg ?? "未知错误"}(code ${code})`, 502, JSON.stringify(j).slice(0, 500));
  }
  return vid;
}

/** Refresh the 168h timer via a minimum-cost T2A; touches local state on success. */
export async function keepaliveVoice(voiceId: string): Promise<void> {
  const { baseUrl, apiKey } = minimaxCreds();
  const payload = {
    model: "speech-02-turbo",
    text: "嗯。",
    stream: false,
    voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
    audio_setting: { sample_rate: 16000, bitrate: 32000, format: "mp3", channel: 1 },
  };
  let r: Response;
  try {
    r = await fetch(`${baseUrl}/t2a_v2`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new CloneError(`续期失败:网络错误 ${(e as Error).message}`, 502);
  }
  if (!r.ok) throw new CloneError(`续期失败:HTTP ${r.status}`, 502, (await r.text()).slice(0, 300));
  const j: any = await r.json();
  if ((j?.base_resp?.status_code ?? 0) !== 0) {
    throw new CloneError(`续期失败:${j?.base_resp?.status_msg ?? "未知错误"}`, 502, JSON.stringify(j).slice(0, 500));
  }
  touchVoice(voiceId);
}

/** High-level: upload → clone → persist. Returns the new ClonedVoice. */
export async function cloneVoice(filePath: string, label: string): Promise<ClonedVoice> {
  const fileId = await uploadSample(filePath);
  const voiceId = await submitClone(fileId);
  const now = Math.floor(Date.now() / 1000);
  const voice: ClonedVoice = {
    voice_id: voiceId,
    label: label || path.basename(filePath),
    created_at: now,
    last_used_at: 0,
    permanent: false,
    sample_filename: path.basename(filePath),
  };
  addVoice(voice);
  return voice;
}
