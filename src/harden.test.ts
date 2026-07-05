import { test } from "node:test";
import assert from "node:assert/strict";
import { hardenHyperFrames } from "./harden.ts";

const EXTERNAL = /https?:\/\/(cdn\.jsdelivr\.net|cdn\.tailwindcss\.com|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/i;

test("tailwind CDN script is vendored — the exact 11-min-hang regression", () => {
  const html = `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body></body></html>`;
  const { html: out } = hardenHyperFrames(html, undefined);
  assert.ok(!/cdn\.tailwindcss\.com/i.test(out), "tailwind CDN still referenced");
});

test("gsap CDN script is vendored", () => {
  const html = `<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script></head><body></body></html>`;
  const { html: out } = hardenHyperFrames(html, undefined);
  assert.ok(!/cdn\.jsdelivr\.net/i.test(out), "gsap CDN still referenced");
});

test("hardened output has zero fetchable external links (offline-safe invariant)", () => {
  const html = `<!doctype html><html><head>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    </head><body>汉字</body></html>`;
  const { html: out } = hardenHyperFrames(html, undefined);
  assert.ok(!EXTERNAL.test(out), "residual external URL: " + (out.match(EXTERNAL) || [])[0]);
});

test("plain html with no CDNs is returned intact-ish (no external links introduced)", () => {
  const html = `<!doctype html><html><head></head><body>hello</body></html>`;
  const { html: out } = hardenHyperFrames(html, undefined);
  assert.ok(!EXTERNAL.test(out));
});
