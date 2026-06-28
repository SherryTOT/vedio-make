/**
 * Pexels — free public stock photo + video API.
 *
 * Auth: API key (free at https://www.pexels.com/api/). Set PEXELS_API_KEY env
 * var or add an entry to ~/.video-toolkit/providers.json under id="pexels".
 *
 * Endpoints we use:
 *   GET https://api.pexels.com/v1/search?query=…&per_page=…&orientation=…
 *   GET https://api.pexels.com/videos/search?query=…&per_page=…&orientation=…
 *
 * Licensing: Pexels License — free for commercial use, no attribution required.
 */

import fs from "node:fs";
import path from "node:path";
import type { AssetClient, AssetSearchResult } from "../types.ts";
import { loadProviderConfig } from "../shared.ts";

export const pexelsAsset: AssetClient = {
  id: "pexels",

  async search({ query, type = "photo", orientation, limit = 8 }) {
    const cfg = loadProviderConfig("pexels");
    const isVideo = type === "video";
    const baseUrl = isVideo ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search";
    const params = new URLSearchParams({
      query,
      per_page: String(Math.min(80, Math.max(1, limit))),
    });
    if (orientation) params.set("orientation", orientation);

    const resp = await fetch(`${baseUrl}?${params}`, {
      headers: { Authorization: cfg.api_key },
    });
    if (!resp.ok) throw new Error(`Pexels search ${resp.status}: ${await resp.text()}`);
    const data = (await resp.json()) as any;
    const items = isVideo ? data.videos : data.photos;
    if (!Array.isArray(items)) return [];

    return items.map((it: any): AssetSearchResult => {
      if (isVideo) {
        // Pexels videos have multiple resolutions in video_files; pick the largest mp4 ≤ 4K
        const files = (it.video_files || []).filter((f: any) => f.file_type === "video/mp4");
        files.sort((a: any, b: any) => (b.width || 0) - (a.width || 0));
        const best = files.find((f: any) => (f.width || 0) <= 3840) || files[0];
        return {
          id: String(it.id),
          provider: "pexels",
          type: "video",
          downloadUrl: best?.link || "",
          previewUrl: it.image,
          width: best?.width,
          height: best?.height,
          author: it.user?.name,
          license: "Pexels License",
          pageUrl: it.url,
          title: it.url?.split("/").filter(Boolean).pop()?.replace(/-/g, " "),
          tags: [],
        };
      }
      return {
        id: String(it.id),
        provider: "pexels",
        type: "photo",
        downloadUrl: it.src?.original || it.src?.large2x || it.src?.large || "",
        previewUrl: it.src?.medium,
        width: it.width,
        height: it.height,
        author: it.photographer,
        license: "Pexels License",
        pageUrl: it.url,
        title: it.alt,
        tags: [],
      };
    }).filter((r: AssetSearchResult) => r.downloadUrl);
  },

  async download(result, destPath) {
    if (!result.downloadUrl) throw new Error(`pexels: result has no downloadUrl`);
    const r = await fetch(result.downloadUrl);
    if (!r.ok) throw new Error(`pexels download ${r.status} from ${result.downloadUrl}`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return destPath;
  },
};
