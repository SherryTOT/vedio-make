/**
 * Microsoft Edge "read aloud" TTS — free, no key, no quota.
 *
 * Ported from Restate's Edge path (it used the Python `edge-tts` lib). Node 22+
 * ships a global `WebSocket`, so we speak the protocol directly — no dependency.
 *
 * The free engine in the two-engine design: any voice id WITHOUT a `minimax:`
 * prefix routes here (see providers/voice-router.ts). MiniMax-only params
 * (emotion / pitch / vol / language) are ignored; we DO honor `speed` (mapped to
 * SSML prosody rate) so the pipeline's overflow-fit retry works on Edge voices too.
 *
 * Soft dependency: if Microsoft rejects the handshake (their `Sec-MS-GEC` DRM
 * token rotates), tts() throws a clear error and the caller falls back / reports
 * "Edge 配音组件不可用" — it never crashes the run.
 */
import crypto from "node:crypto";
import type { TtsClient } from "../types.ts";

const TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const GEC_VERSION = "1-130.0.2849.68";
const WS_BASE =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
// 100-ns ticks between 1601-01-01 (Windows FILETIME epoch) and 1970-01-01.
const WIN_EPOCH = 11644473600n;

/** Curated zh-CN / zh-HK / zh-TW / en voices. Edge has ~470 total; these read cleanest. */
const EDGE_VOICES: Array<{ id: string; label: string; gender?: "male" | "female"; tags?: string[] }> = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 女 · 自然亲切", gender: "female", tags: ["narration", "warm"] },
  { id: "zh-CN-XiaoyiNeural",   label: "晓伊 · 女 · 活泼",     gender: "female", tags: ["young"] },
  { id: "zh-CN-YunxiNeural",    label: "云希 · 男 · 阳光",     gender: "male",   tags: ["young", "warm"] },
  { id: "zh-CN-YunjianNeural",  label: "云健 · 男 · 浑厚",     gender: "male",   tags: ["narration", "deep"] },
  { id: "zh-CN-YunyangNeural",  label: "云扬 · 男 · 专业播报", gender: "male",   tags: ["news"] },
  { id: "zh-CN-YunxiaNeural",   label: "云夏 · 男 · 少年",     gender: "male",   tags: ["young"] },
  { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北 · 女 · 东北话", gender: "female", tags: ["dialect"] },
  { id: "zh-HK-HiuMaanNeural",  label: "曉曼 · 女 · 粤语",     gender: "female", tags: ["cantonese"] },
  { id: "zh-TW-HsiaoChenNeural", label: "曉臻 · 女 · 台湾",    gender: "female", tags: ["taiwan"] },
  { id: "en-US-AriaNeural",     label: "Aria · 女 · English",  gender: "female", tags: ["english"] },
  { id: "en-US-GuyNeural",      label: "Guy · 男 · English",   gender: "male",   tags: ["english"] },
];

function secMsGec(): string {
  // ticks = (unix_seconds + WIN_EPOCH) * 1e7, floored to the nearest 5 minutes.
  let ticks = (BigInt(Math.floor(Date.now() / 1000)) + WIN_EPOCH) * 10_000_000n;
  ticks -= ticks % 3_000_000_000n; // 300s * 1e7 ticks/s
  return crypto.createHash("sha256").update(`${ticks}${TRUSTED_TOKEN}`).digest("hex").toUpperCase();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function langOf(voiceId: string): string {
  const m = voiceId.match(/^([a-z]{2}-[A-Z]{2})/);
  return m ? m[1] : "zh-CN";
}

/**
 * Map an arbitrary voiceId to a REAL Edge voice. Critical for the free fallback
 * path: when a MiniMax run downgrades to Edge, it carries the MiniMax voiceId
 * (e.g. the default "presenter_male") — which is NOT a valid Edge SSML voice, so
 * Microsoft returns no audio and the whole free path fails. We keep genuine Edge
 * ids as-is and map anything else to a gender-matched Edge default.
 * (Check female BEFORE male — "female" contains the substring "male".)
 */
export function resolveEdgeVoice(voiceId?: string): string {
  const v = (voiceId || "").trim();
  if (/-[A-Za-z]+Neural$/.test(v)) return v; // already an Edge voice id
  if (/female|女/i.test(v)) return "zh-CN-XiaoxiaoNeural";
  if (/male|男/i.test(v)) return "zh-CN-YunjianNeural";
  return "zh-CN-XiaoxiaoNeural"; // unknown / empty → warm female narration
}

/** Parse a binary Edge frame: [2-byte BE header length][header text][audio bytes]. */
function parseBinaryFrame(buf: Buffer): Buffer | null {
  if (buf.length < 2) return null;
  const headerLen = buf.readUInt16BE(0);
  const header = buf.subarray(2, 2 + headerLen).toString("utf8");
  if (!/Path:audio/i.test(header)) return null;
  return buf.subarray(2 + headerLen);
}

export const edgeTts: TtsClient = {
  id: "edge",

  voices() {
    return EDGE_VOICES;
  },

  async tts(opts) {
    const voice = resolveEdgeVoice(opts.voiceId);
    const ratePct = Math.round(((opts.speed ?? 1.0) - 1) * 100);
    const rate = `${ratePct >= 0 ? "+" : ""}${ratePct}%`;
    const text = opts.text;

    const url =
      `${WS_BASE}?TrustedClientToken=${TRUSTED_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${GEC_VERSION}`;

    const reqId = crypto.randomBytes(16).toString("hex");
    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${langOf(voice)}'>` +
      `<voice name='${voice}'><prosody rate='${rate}' pitch='+0Hz'>${escapeXml(text)}</prosody></voice></speak>`;

    return await new Promise<Buffer>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(new Error(`Edge 配音组件不可用: ${(e as Error).message}`));
        return;
      }
      (ws as any).binaryType = "arraybuffer";
      const chunks: Buffer[] = [];
      let settled = false;
      const done = (err: Error | null, audio?: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        if (err) reject(err);
        else resolve(audio!);
      };
      const timer = setTimeout(() => done(new Error("Edge TTS timeout (30s)")), 30_000);

      ws.onopen = () => {
        const ts = new Date().toISOString();
        ws.send(
          `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          JSON.stringify({
            context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false }, outputFormat: "audio-24khz-48kbitrate-mono-mp3" } } },
          }),
        );
        ws.send(
          `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${ts}\r\nPath:ssml\r\n\r\n${ssml}`,
        );
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === "string") {
          if (/Path:turn\.end/i.test(ev.data)) {
            if (!chunks.length) return done(new Error("Edge TTS returned no audio"));
            done(null, Buffer.concat(chunks));
          }
          return;
        }
        const buf = Buffer.from(ev.data as ArrayBuffer);
        const audio = parseBinaryFrame(buf);
        if (audio && audio.length) chunks.push(audio);
      };

      ws.onerror = () =>
        done(new Error("Edge 配音组件连接失败(Microsoft 拒绝握手,可能 Sec-MS-GEC 令牌已轮换)"));
      ws.onclose = () => {
        // A clean synthesis always fires Path:turn.end first (which settles with
        // the full audio). Reaching onclose unsettled means the socket dropped
        // mid-stream — any chunks so far are TRUNCATED, so fail rather than cache
        // half a narration line as if it were complete.
        if (!settled) {
          done(new Error(chunks.length
            ? "Edge TTS socket closed mid-stream (audio truncated)"
            : "Edge TTS socket closed before audio"));
        }
      };
    });
  },
};
