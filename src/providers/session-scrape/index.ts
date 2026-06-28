/**
 * Session-based asset scrapers (51yuansu / Envato).
 *
 * Required because neither site has a public asset-download API. The pattern:
 *
 *   1. User exports browser cookies → ~/.pipeline/sessions/<provider>.json
 *   2. Adapter loads cookies into puppeteer
 *   3. Navigate to search page, parse result links via DOM selectors
 *   4. For download: click site's "download" button so the per-account license
 *      counter records the download on the user's account (Envato in particular
 *      binds licenses to the downloading account).
 *
 * The actual puppeteer driver is dynamically imported only when search/download
 * is invoked — keeps the pipeline lightweight when scrapers aren't used.
 *
 * RISKS (must call out before use): ToS forbids automated access. Account bans
 * are possible. See ./README.md for the full rundown.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AssetClient, AssetSearchResult } from "../types.ts";

const SESSIONS_DIR = path.join(os.homedir(), ".pipeline", "sessions");

interface CookieJar {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

function loadSession(providerId: string): CookieJar[] {
  const file = path.join(SESSIONS_DIR, `${providerId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No session for '${providerId}'. Export your logged-in cookies from Chrome ` +
        `(DevTools → Application → Cookies) and save as JSON at ${file}. ` +
        `See pipeline/src/providers/session-scrape/README.md for the format.`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Lazy-load puppeteer; throws a clear error if not installed. */
async function loadPuppeteer(): Promise<any> {
  try {
    return await import("puppeteer");
  } catch {
    throw new Error(
      `Session scrapers require puppeteer. Install it with: cd pipeline && npm i puppeteer (~250 MB Chromium download).`
    );
  }
}

async function withSession<T>(
  providerId: string,
  fn: (page: any, browser: any) => Promise<T>
): Promise<T> {
  const puppeteer = await loadPuppeteer();
  const cookies = loadSession(providerId);
  const browser = await puppeteer.launch({ headless: "new" });
  try {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setCookie(...cookies);
    return await fn(page, browser);
  } finally {
    await browser.close();
  }
}

// ─── 51yuansu adapter ────────────────────────────────────────────────────
export const yuansu51Asset: AssetClient = {
  id: "51yuansu",
  async search({ query, limit = 6 }) {
    return withSession("51yuansu", async (page) => {
      const url = `https://www.51yuansu.com/search-0-0-0/${encodeURIComponent(query)}.html`;
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      // Selector likely needs maintenance — 51yuansu changes markup periodically.
      const items: AssetSearchResult[] = await page.$$eval(
        "a[href*='/sucai-']",
        (els: any[], cap: number) =>
          els.slice(0, cap).map((a: any) => {
            const img = a.querySelector("img");
            return {
              id: a.href.split("-").pop()?.replace(".html", "") || a.href,
              provider: "51yuansu",
              type: "psd" as const,
              downloadUrl: a.href, // the page URL — actual download happens via download()
              previewUrl: img?.src || "",
              title: a.getAttribute("title") || img?.alt || "",
              license: "51yuansu (subscription)",
              pageUrl: a.href,
            };
          }),
        limit
      );
      return items;
    });
  },

  async download(result, destPath) {
    // 51yuansu requires navigating to the asset page and clicking the
    // 立即下载 button, which triggers a session-authenticated download.
    return withSession("51yuansu", async (page) => {
      await page.goto(result.pageUrl ?? result.downloadUrl, { waitUntil: "networkidle2" });
      // Heuristic: find the download button; site uses .download-btn or similar.
      const dlSelector = ".download-btn, .dl-btn, a[href*='/download/']";
      const dlEl = await page.$(dlSelector);
      if (!dlEl) {
        throw new Error(`51yuansu: download button not found — selectors likely need updating`);
      }
      // Configure download dir
      const dir = path.dirname(destPath);
      fs.mkdirSync(dir, { recursive: true });
      await (page as any)._client().send("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: dir,
      });
      await dlEl.click();
      // Wait for any file to appear in dir matching the asset id
      const start = Date.now();
      while (Date.now() - start < 30000) {
        const files = fs.readdirSync(dir).filter((f) => f.includes(result.id));
        if (files.length) {
          fs.renameSync(path.join(dir, files[0]), destPath);
          return destPath;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`51yuansu download timeout`);
    });
  },
};

// ─── Envato Elements adapter ─────────────────────────────────────────────
export const envatoAsset: AssetClient = {
  id: "envato",
  async search({ query, type = "photo", limit = 6 }) {
    // Envato URL convention: /<category>/<query>
    const catMap: Record<string, string> = {
      photo: "stock-photos",
      video: "stock-video",
      music: "royalty-free-music",
      vector: "graphic-templates",
      template: "graphic-templates",
      psd: "graphic-templates",
      icon: "icons",
      illustration: "illustrations",
    };
    const category = catMap[type] || "stock-photos";
    return withSession("envato", async (page) => {
      const url = `https://elements.envato.com/${category}/${encodeURIComponent(query)}`;
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      // Envato uses tile components; selector needs to track their markup.
      const items: AssetSearchResult[] = await page.$$eval(
        "[data-testid='hit-tile'] a[href*='/item/'], a[href*='elements.envato.com/'][href*='-']",
        (els: any[], cap: number, t: string) =>
          els.slice(0, cap).map((a: any) => {
            const img = a.querySelector("img");
            return {
              id: a.href.split("/").pop() || a.href,
              provider: "envato",
              type: t as any,
              downloadUrl: a.href,
              previewUrl: img?.src || "",
              title: img?.alt || "",
              license: "Envato Elements Subscription",
              pageUrl: a.href,
            };
          }),
        limit,
        type
      );
      return items;
    });
  },

  async download(result, destPath) {
    // Envato per-download license registration: must click the in-page
    // "Download" button so the asset is bound to the logged-in account.
    return withSession("envato", async (page) => {
      await page.goto(result.pageUrl ?? result.downloadUrl, { waitUntil: "networkidle2" });
      const dlButton = await page.waitForSelector(
        "[data-testid='download-button'], button:has-text('Download')",
        { timeout: 15000 }
      );
      if (!dlButton) throw new Error("envato: Download button not found");
      const dir = path.dirname(destPath);
      fs.mkdirSync(dir, { recursive: true });
      await (page as any)._client().send("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: dir,
      });
      await dlButton.click();
      // Envato may show a license-confirmation modal — auto-accept if present.
      try {
        const confirm = await page.waitForSelector("[data-testid='download-license-confirm']", { timeout: 4000 });
        if (confirm) await confirm.click();
      } catch {}
      const start = Date.now();
      while (Date.now() - start < 60000) {
        const files = fs.readdirSync(dir).filter((f) => !f.endsWith(".crdownload"));
        if (files.length) {
          // Pick most-recently modified
          const latest = files
            .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)[0];
          fs.renameSync(path.join(dir, latest.f), destPath);
          return destPath;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`envato download timeout`);
    });
  },
};
