/**
 * hardenHyperFrames — make a generated HyperFrames scene HTML portable and
 * deterministic before it is written + rendered.
 *
 * Generated scene HTML (from src/methods/registry.ts) has two render-time
 * fragilities that only bite OFF this Mac (Docker / Linux / CI / offline):
 *
 *   1. CJK fonts: every method requests `font-family: "PingFang SC" / "Source
 *      Han Sans SC" / "Noto Sans SC" / "Noto Serif SC" / "Songti SC"` but ships
 *      NO @font-face. HyperFrames does NOT embed these. On a host without the
 *      system font every Chinese glyph renders as tofu — silently.
 *      Some methods even pull the font from fonts.googleapis.com at render
 *      time (network-dependent, non-deterministic, fails offline).
 *
 *   2. JS libs (gsap / anime / lottie) loaded from cdn.jsdelivr.net at render
 *      time. A network blip → the GSAP timeline never registers →
 *      `Cannot read properties of undefined (reading 'totalDuration')` and a
 *      broken or failed render.
 *
 * This transform (applied at the single render chokepoint, so it covers every
 * current AND future method without touching the generators):
 *   - strips Google-Fonts <link> tags,
 *   - injects @font-face blocks aliasing the requested families to bundled
 *     local woff2 files,
 *   - rewrites gsap/anime/lottie CDN <script src> to bundled local copies,
 *   - returns the extra side files to copy next to the scene index.html.
 *
 * Bundled assets live in pipeline/assets/{fonts,vendor} and are resolved
 * relative to THIS module (not the user project), so any project renders
 * portably.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");

const FONT_FILES = {
  "fonts/NotoSansSC-400.woff2": path.join(ASSETS, "fonts", "NotoSansSC-400.woff2"),
  "fonts/NotoSansSC-700.woff2": path.join(ASSETS, "fonts", "NotoSansSC-700.woff2"),
  "fonts/NotoSerifSC-700.woff2": path.join(ASSETS, "fonts", "NotoSerifSC-700.woff2"),
} as const;

const VENDOR_FILES: Record<string, string> = {
  "vendor/gsap.min.js": path.join(ASSETS, "vendor", "gsap.min.js"),
  "vendor/anime.min.js": path.join(ASSETS, "vendor", "anime.min.js"),
  "vendor/lottie.min.js": path.join(ASSETS, "vendor", "lottie.min.js"),
};

// Sans families used by generators → bundled Noto Sans SC.
// Serif families → bundled Noto Serif SC.
const SANS_FAMILIES = ["PingFang SC", "Source Han Sans SC", "Noto Sans SC"];
const SERIF_FAMILIES = ["Noto Serif SC", "Songti SC"];

function fontFaceBlock(): string {
  const faces: string[] = [];
  for (const fam of SANS_FAMILIES) {
    faces.push(
      `@font-face{font-family:"${fam}";font-style:normal;font-weight:100 500;` +
        `font-display:block;src:url("fonts/NotoSansSC-400.woff2") format("woff2");}`,
      `@font-face{font-family:"${fam}";font-style:normal;font-weight:501 900;` +
        `font-display:block;src:url("fonts/NotoSansSC-700.woff2") format("woff2");}`,
    );
  }
  for (const fam of SERIF_FAMILIES) {
    faces.push(
      `@font-face{font-family:"${fam}";font-style:normal;font-weight:100 900;` +
        `font-display:block;src:url("fonts/NotoSerifSC-700.woff2") format("woff2");}`,
    );
  }
  return `<style id="pipeline-cjk-fonts">${faces.join("")}</style>`;
}

const CDN_REWRITES: Array<{ re: RegExp; local: string }> = [
  { re: /https?:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"']*/g, local: "vendor/gsap.min.js" },
  { re: /https?:\/\/cdn\.jsdelivr\.net\/npm\/animejs@[^"']*/g, local: "vendor/anime.min.js" },
  {
    re: /https?:\/\/cdn\.jsdelivr\.net\/npm\/lottie-web@[^"']*/g,
    local: "vendor/lottie.min.js",
  },
];

export interface HardenResult {
  html: string;
  sideFiles: Record<string, string>;
}

export function hardenHyperFrames(
  html: string,
  sideFiles: Record<string, string> | undefined,
): HardenResult {
  let out = html;

  // 1. Strip Google Fonts <link> (stylesheet + preconnect/dns-prefetch).
  out = out.replace(
    /[ \t]*<link\b[^>]*\b(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\s*\n?/gi,
    "",
  );

  // 2. Inject @font-face aliases just before </head> (fallback: prepend body).
  const faceBlock = fontFaceBlock();
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${faceBlock}</head>`);
  } else if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/(<body[^>]*>)/i, `$1${faceBlock}`);
  } else {
    out = faceBlock + out;
  }

  // 3. Rewrite gsap/anime/lottie CDN URLs → bundled local copies.
  const extra: Record<string, string> = { ...(sideFiles ?? {}) };
  for (const { re, local } of CDN_REWRITES) {
    if (re.test(out)) {
      out = out.replace(re, local);
      extra[local] = VENDOR_FILES[local];
    }
  }

  // 4. Always ship the CJK fonts next to index.html so @font-face resolves.
  for (const [rel, abs] of Object.entries(FONT_FILES)) {
    if (fs.existsSync(abs)) extra[rel] = abs;
  }

  return { html: out, sideFiles: extra };
}
