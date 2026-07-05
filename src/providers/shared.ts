/**
 * Shared utilities for provider adapters — config loading from
 * Restate's `~/.video-toolkit/providers.json` + env-var fallback.
 *
 * All current providers (Minimax, DeepSeek, Moonshot, etc.) speak OpenAI
 * chat-completion shape, so their auth pattern is the same: a Bearer API
 * key + a base URL. The TTS / image / search endpoints diverge but the
 * key+url pair is universal.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const PROVIDERS_PATH = path.join(os.homedir(), ".video-toolkit", "providers.json");
/** Keychain service that Restate writes provider keys under (post-Keychain migration). */
const KEYCHAIN_SERVICE = "com.restate.mac";

/** Read a Restate-managed provider key from macOS Keychain. Returns "" on miss. */
function keychainGet(providerId: string): string {
  if (process.platform !== "darwin") return "";
  const r = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-a", providerId, "-s", KEYCHAIN_SERVICE, "-w"],
    { encoding: "utf8" }
  );
  if (r.status === 0) return (r.stdout || "").trim();
  return "";
}

export interface ProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
}

let cached: ProviderConfig[] | null = null;

function loadAll(): ProviderConfig[] {
  if (cached) return cached;
  if (fs.existsSync(PROVIDERS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf8"));
      cached = (data.providers as ProviderConfig[]) ?? [];
      return cached;
    } catch {}
  }
  cached = [];
  return cached;
}

/**
 * Load config for a provider, falling back to env vars.
 * Throws if no API key can be found.
 *
 * Env var convention: <UPPERCASE_ID>_API_KEY (e.g. MINIMAX_API_KEY, OPENAI_API_KEY)
 */
export function loadProviderConfig(providerId: string): ProviderConfig {
  const all = loadAll();
  const cfg = all.find((p) => p.id === providerId);
  // Resolution order: ENV → providers.json plain key → macOS Keychain (Restate-managed).
  // Restate v0.1+ migrates plain keys to Keychain on first load, so plain values
  // in providers.json may be empty even when the user did set them.
  const envKey = process.env[`${providerId.toUpperCase()}_API_KEY`] || "";
  let apiKey = envKey || cfg?.api_key || "";
  if (!apiKey) apiKey = keychainGet(providerId);

  if (!apiKey) {
    throw new Error(
      `No API key for provider '${providerId}'. ` +
        `Tried: ${providerId.toUpperCase()}_API_KEY env, ~/.video-toolkit/providers.json, macOS Keychain (service=${KEYCHAIN_SERVICE}, account=${providerId}). ` +
        `Set the env var (e.g. export ${providerId.toUpperCase()}_API_KEY=…) or see README "Provider keys". ` +
        `Tip: the keyless free path needs no key — use Edge TTS + Pexels/Unsplash + hand-picked methods.`
    );
  }
  return {
    id: providerId,
    name: cfg?.name ?? providerId,
    base_url: cfg?.base_url ?? "",
    api_key: apiKey,
    model: cfg?.model ?? "",
  };
}

/**
 * fetch() with a hard timeout. Every provider network call runs inside the
 * daemon's FIFO task chain, so a single stalled request (no response, half-open
 * socket) would wedge ALL queued tasks indefinitely. AbortSignal.timeout aborts
 * the request after `timeoutMs`, surfacing a catchable error instead of a hang.
 * Respects a caller-supplied signal if one is already set.
 */
export function fetchT(url: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}

export function hasProviderKey(providerId: string): boolean {
  const all = loadAll();
  const cfg = all.find((p) => p.id === providerId);
  const envKey = process.env[`${providerId.toUpperCase()}_API_KEY`] || "";
  if (envKey || cfg?.api_key) return true;
  return Boolean(keychainGet(providerId));
}
