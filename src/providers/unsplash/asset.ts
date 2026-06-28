/**
 * Unsplash — free public photo API.
 *
 * Auth: Access Key (free at https://unsplash.com/developers). Demo apps get
 * 50 requests/hour; production apps need approval for higher limits.
 *
 * Set UNSPLASH_API_KEY (your Access Key, not the Secret) or providers.json id=unsplash.
 *
 * Licensing: Unsplash License — free, but BY law of the API:
 *   1. You must track-download (POST /photos/:id/download) for attribution stats.
 *   2. Display attribution in your end-product where reasonable.
 */

import fs from "node:fs";
import path from "node:path";
import type { AssetClient, AssetSearchResult } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";

export const unsplashAsset: AssetClient = {
  id: "unsplash",

  async search({ query, type = "photo", orientation, limit = 8 }) {
    if (type !== "photo") return []; // Unsplash is photo-only
    const cfg = loadProviderConfig("unsplash");
    const params = new URLSearchParams({
      query,
      per_page: String(Math.min(30, Math.max(1, limit))),
    });
    if (orientation) params.set("orientation", orientation);
    const resp = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
      headers: { Authorization: `Client-ID ${cfg.api_key}` },
    });
    if (!resp.ok) throw new Error(`Unsplash search ${resp.status}: ${await resp.text()}`);
    const data = (await resp.json()) as any;
    return (data.results || []).map((it: any): AssetSearchResult => ({
      id: it.id,
      provider: "unsplash",
      type: "photo",
      downloadUrl: it.urls?.raw || it.urls?.full || it.urls?.regular,
      previewUrl: it.urls?.small,
      width: it.width,
      height: it.height,
      author: it.user?.name,
      license: "Unsplash License",
      pageUrl: it.links?.html,
      title: it.description || it.alt_description,
      tags: (it.tags || []).map((t: any) => t.title),
    })).filter((r: AssetSearchResult) => r.downloadUrl);
  },

  async download(result, destPath) {
    if (!result.downloadUrl) throw new Error(`unsplash: result has no downloadUrl`);
    // Unsplash API asks us to ping /download to register the download.
    try {
      const cfg = loadProviderConfig("unsplash");
      await fetch(`https://api.unsplash.com/photos/${result.id}/download`, {
        headers: { Authorization: `Client-ID ${cfg.api_key}` },
      });
    } catch {
      // not fatal — just track-download analytics
    }
    const r = await fetch(result.downloadUrl);
    if (!r.ok) throw new Error(`unsplash download ${r.status}`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, Buffer.from(await r.arrayBuffer()));
    return destPath;
  },
};
