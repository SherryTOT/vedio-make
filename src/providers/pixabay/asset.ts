/**
 * Pixabay — free public stock photo + video + illustration API.
 *
 * Auth: API key (free at https://pixabay.com/api/docs/).
 * Set PIXABAY_API_KEY env var or providers.json id="pixabay".
 *
 * Licensing: Pixabay Content License — free for commercial use, no attribution.
 */

import fs from "node:fs";
import path from "node:path";
import type { AssetClient, AssetSearchResult } from "../types.ts";
import { loadProviderConfig, fetchT } from "../shared.ts";

const TYPE_MAP: Record<string, string> = {
  photo: "photo",
  illustration: "illustration",
  vector: "vector",
};

export const pixabayAsset: AssetClient = {
  id: "pixabay",

  async search({ query, type = "photo", orientation, limit = 8 }) {
    const cfg = loadProviderConfig("pixabay");
    const isVideo = type === "video";
    const baseUrl = isVideo ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/";
    const params = new URLSearchParams({
      key: cfg.api_key,
      q: query,
      per_page: String(Math.min(200, Math.max(3, limit))),
      safesearch: "true",
    });
    if (!isVideo && TYPE_MAP[type]) params.set("image_type", TYPE_MAP[type]);
    if (orientation && !isVideo) params.set("orientation", orientation);

    const resp = await fetchT(`${baseUrl}?${params}`, {}, 30_000);
    if (!resp.ok) throw new Error(`Pixabay search ${resp.status}: ${await resp.text()}`);
    const data = (await resp.json()) as any;
    const items = data.hits || [];

    return items.map((it: any): AssetSearchResult => {
      if (isVideo) {
        const sizes = it.videos || {};
        // largest available: large > medium > small > tiny
        const best = sizes.large || sizes.medium || sizes.small || sizes.tiny;
        return {
          id: String(it.id),
          provider: "pixabay",
          type: "video",
          downloadUrl: best?.url || "",
          previewUrl: it.picture_id ? `https://i.vimeocdn.com/video/${it.picture_id}_640x360.jpg` : "",
          width: best?.width,
          height: best?.height,
          author: it.user,
          license: "Pixabay Content License",
          pageUrl: it.pageURL,
          title: it.tags,
          tags: String(it.tags || "").split(",").map((t: string) => t.trim()),
        };
      }
      return {
        id: String(it.id),
        provider: "pixabay",
        type: type as any,
        downloadUrl: it.largeImageURL || it.webformatURL,
        previewUrl: it.webformatURL,
        width: it.imageWidth,
        height: it.imageHeight,
        author: it.user,
        license: "Pixabay Content License",
        pageUrl: it.pageURL,
        title: it.tags,
        tags: String(it.tags || "").split(",").map((t: string) => t.trim()),
      };
    }).filter((r: AssetSearchResult) => r.downloadUrl);
  },

  async download(result, destPath) {
    if (!result.downloadUrl) throw new Error(`pixabay: result has no downloadUrl`);
    const r = await fetchT(result.downloadUrl);
    if (!r.ok) throw new Error(`pixabay download ${r.status}`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, Buffer.from(await r.arrayBuffer()));
    return destPath;
  },
};
