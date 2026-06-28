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
