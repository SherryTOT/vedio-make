/**
 * Provider registry — maps capability + provider id → adapter instance.
 *
 * Default per capability is Minimax (the only fully-keyed provider in the
 * shared registry). To override, pass --provider=<id> to a CLI subcommand or
 * set the env var PIPELINE_<CAPABILITY>_PROVIDER=<id> (e.g.
 * PIPELINE_CHAT_PROVIDER=deepseek). Per-capability defaults can also be set
 * in providers.json under an optional `defaults` key, but we don't read that
 * yet — keep it simple.
 *
 * Registration is declarative; adding a provider is a one-line entry below.
 */

import type {
  AssetClient,
  Capability,
  ChatClient,
  ImageClient,
  MusicClient,
  SearchClient,
  TtsClient,
} from "./types.ts";

// ── concrete adapters ────────────────────────────────────────────────────
import { minimaxChat } from "./minimax/chat.ts";
import { minimaxTts } from "./minimax/tts.ts";
import { minimaxMusic } from "./minimax/music.ts";
import { minimaxImage } from "./minimax/image.ts";
import { minimaxSearch } from "./minimax/search.ts";

import { deepseekChat } from "./deepseek/chat.ts";

import { openaiChat } from "./openai/chat.ts";
import { openaiTts } from "./openai/tts.ts";
import { openaiImage } from "./openai/image.ts";

import { tavilySearch } from "./tavily/search.ts";

import { edgeTts } from "./edge/tts.ts";
import { voiceRouter } from "./voice-router.ts";

import { pexelsAsset } from "./pexels/asset.ts";
import { unsplashAsset } from "./unsplash/asset.ts";
import { pixabayAsset } from "./pixabay/asset.ts";
import { yuansu51Asset, envatoAsset } from "./session-scrape/index.ts";

const REGISTRY = {
  chat: {
    minimax: minimaxChat,
    deepseek: deepseekChat,
    openai: openaiChat,
  } as Record<string, ChatClient>,
  tts: {
    voice: voiceRouter,   // two-engine prefix router (default) — Edge free + MiniMax paid + clones
    minimax: minimaxTts,
    edge: edgeTts,        // free, no key
    openai: openaiTts,
  } as Record<string, TtsClient>,
  music: {
    minimax: minimaxMusic,
  } as Record<string, MusicClient>,
  image: {
    minimax: minimaxImage,
    openai: openaiImage,
  } as Record<string, ImageClient>,
  search: {
    minimax: minimaxSearch,
    tavily: tavilySearch,
  } as Record<string, SearchClient>,
  asset: {
    pexels:    pexelsAsset,
    unsplash:  unsplashAsset,
    pixabay:   pixabayAsset,
    "51yuansu": yuansu51Asset,
    envato:    envatoAsset,
  } as Record<string, AssetClient>,
};

const DEFAULT_PROVIDER: Record<Capability, string> = {
  chat: "minimax",
  tts: "voice",     // two-engine router; bare/legacy voice ids still route to MiniMax
  music: "minimax",
  image: "minimax",
  search: "minimax",
  asset: "pexels",
};

export function listProviders(capability: Capability): string[] {
  return Object.keys(REGISTRY[capability]);
}

// ── Fallback chains ───────────────────────────────────────────────────────
// When a provider call fails at runtime (missing key, network blip, restricted
// network — Edge's handshake is a known offender), fall back to a safer one.
// Edge TTS is free and needs no key, so it's the natural TTS safety net.
const FALLBACKS: Partial<Record<Capability, Record<string, string>>> = {
  tts:    { voice: "edge", minimax: "edge" },
  chat:   { minimax: "deepseek", deepseek: "openai" },
  image:  { minimax: "openai" },
  search: { minimax: "tavily", tavily: "minimax" },
};

/** Ordered provider chain [primary, …fallbacks], cycle-safe, only existing ids. */
export function fallbackChain(capability: Capability, providerId?: string): string[] {
  const start = resolveId(capability, providerId);
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = start;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (REGISTRY[capability][cur]) chain.push(cur);
    cur = FALLBACKS[capability]?.[cur];
  }
  return chain.length ? chain : [start];
}

/**
 * Run `use` against the primary provider; on failure, walk the fallback chain.
 * `onFallback(from, to, err)` fires before each downgrade (e.g. to log a
 * decision). Throws the LAST error if every provider in the chain fails.
 */
export async function withFallback<C, R>(
  capability: Capability,
  providerId: string | undefined,
  get: (id: string) => C,
  use: (client: C, id: string) => Promise<R>,
  onFallback?: (from: string, to: string, err: Error) => void,
): Promise<R> {
  const chain = fallbackChain(capability, providerId);
  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    try {
      return await use(get(id), id);
    } catch (e) {
      lastErr = e;
      if (i < chain.length - 1) onFallback?.(id, chain[i + 1], e as Error);
    }
  }
  throw lastErr;
}

export function getChat(providerId?: string): ChatClient {
  const id = resolveId("chat", providerId);
  const adapter = REGISTRY.chat[id];
  if (!adapter) throw unknown("chat", id);
  return adapter;
}

export function getTts(providerId?: string): TtsClient {
  const id = resolveId("tts", providerId);
  const adapter = REGISTRY.tts[id];
  if (!adapter) throw unknown("tts", id);
  return adapter;
}

export function getMusic(providerId?: string): MusicClient {
  const id = resolveId("music", providerId);
  const adapter = REGISTRY.music[id];
  if (!adapter) throw unknown("music", id);
  return adapter;
}

export function getImage(providerId?: string): ImageClient {
  const id = resolveId("image", providerId);
  const adapter = REGISTRY.image[id];
  if (!adapter) throw unknown("image", id);
  return adapter;
}

export function getSearch(providerId?: string): SearchClient {
  const id = resolveId("search", providerId);
  const adapter = REGISTRY.search[id];
  if (!adapter) throw unknown("search", id);
  return adapter;
}

export function getAsset(providerId?: string): AssetClient {
  const id = resolveId("asset", providerId);
  const adapter = REGISTRY.asset[id];
  if (!adapter) throw unknown("asset", id);
  return adapter;
}

function resolveId(capability: Capability, given?: string): string {
  if (given) return given;
  const envOverride = process.env[`PIPELINE_${capability.toUpperCase()}_PROVIDER`];
  if (envOverride) return envOverride;
  return DEFAULT_PROVIDER[capability];
}

function unknown(capability: Capability, id: string): Error {
  const available = Object.keys(REGISTRY[capability]).join(", ");
  return new Error(
    `Unknown ${capability} provider '${id}'. Available: ${available}`
  );
}
