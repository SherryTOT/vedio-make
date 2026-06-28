/**
 * `pipeline fetch <query>` — search a stock provider and download the top
 * result(s) into the project's assets folder. Optionally attaches the
 * downloaded asset to a scene's foreground or assets list.
 *
 * Examples:
 *   pipeline fetch "夜景 城市" --provider pexels --type photo
 *   pipeline fetch "interview portrait" --provider unsplash --orientation portrait --scene 9
 *   pipeline fetch "city timelapse" --provider pexels --type video --scene 5
 *   pipeline fetch "扫码界面" --provider 51yuansu --type psd       # requires session
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getAsset } from "./providers/registry.ts";
import type { AssetSearchResult } from "./providers/types.ts";
import type { Storyboard } from "./types.ts";

interface FetchOpts {
  query: string;
  provider?: string;
  type?: AssetSearchResult["type"];
  orientation?: "landscape" | "portrait" | "square";
  /** Max results to download (default 1) */
  count?: number;
  /** Attach downloaded asset to scene.assets[] (and scene.foreground if it looks like a fg) */
  sceneIndex?: number;
  projectRoot: string;
  storyboardPath?: string;
}

export async function runFetch(opts: FetchOpts): Promise<string[]> {
  const client = getAsset(opts.provider);
  console.log(`[fetch] provider=${client.id}  query="${opts.query}"  type=${opts.type ?? "photo"}`);
  const results = await client.search({
    query: opts.query,
    type: opts.type,
    orientation: opts.orientation,
    limit: Math.max(opts.count ?? 1, 3),
  });
  if (!results.length) {
    console.warn(`[fetch] no results from ${client.id}`);
    return [];
  }

  const assetsDir = path.join(opts.projectRoot, "assets", "stock", client.id);
  fs.mkdirSync(assetsDir, { recursive: true });

  const take = Math.min(opts.count ?? 1, results.length);
  const downloaded: string[] = [];
  for (let i = 0; i < take; i++) {
    const r = results[i];
    const safeQuery = opts.query.replace(/[^a-zA-Z0-9_一-鿿-]+/g, "_").slice(0, 40);
    const extGuess = r.type === "video" ? "mp4" : r.downloadUrl.match(/\.(\w{3,4})(\?|$)/)?.[1] || "jpg";
    const hash = crypto.createHash("sha1").update(r.downloadUrl).digest("hex").slice(0, 8);
    const fileName = `${safeQuery}-${i + 1}-${hash}.${extGuess}`;
    const destPath = path.join(assetsDir, fileName);
    console.log(
      `[fetch] [${i + 1}/${take}]  ${r.title?.slice(0, 50) ?? "(no title)"}  by ${r.author ?? "?"}  ${r.width}x${r.height}`
    );
    console.log(`         license: ${r.license ?? "?"}`);
    console.log(`         page:    ${r.pageUrl ?? r.downloadUrl}`);
    try {
      await client.download(r, destPath);
      const rel = path.relative(path.join(opts.projectRoot, "assets"), destPath);
      console.log(`         saved:   assets/${rel}  (${(fs.statSync(destPath).size / 1024).toFixed(0)} KB)`);
      downloaded.push(destPath);
    } catch (e) {
      console.error(`         ✗ download failed: ${(e as Error).message}`);
    }
  }

  // Attach to a scene
  if (opts.sceneIndex != null && opts.storyboardPath && downloaded.length) {
    const sb: Storyboard = JSON.parse(fs.readFileSync(opts.storyboardPath, "utf8"));
    const sc = sb.scenes.find((s) => s.index === opts.sceneIndex);
    if (sc) {
      const rel0 = path.relative(path.join(opts.projectRoot, "assets"), downloaded[0]);
      sc.assets = [rel0, ...(sc.assets ?? []).filter((a) => a !== rel0)];
      // Foreground only if filename suggests matted/transparent (PNG with alpha)
      // Don't auto-set foreground here — user can run `pipeline matte` if they want.
      fs.writeFileSync(opts.storyboardPath, JSON.stringify(sb, null, 2));
      console.log(`[fetch] attached to scene ${opts.sceneIndex}: ${rel0}`);
    }
  }

  return downloaded;
}
