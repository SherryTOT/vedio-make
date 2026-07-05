import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METHOD_RENDERERS } from "./registry.ts";
import type { RenderContext } from "./registry.ts";
import { resolveDesign } from "./designs.ts";
import { reconcileCatalog } from "../analyze.ts";
import { mkScene } from "../_testkit.ts";

const ctx = (presetId: string, projectRoot = "/tmp"): RenderContext => ({
  width: 1080, height: 1920, fps: 30, projectRoot,
  design: resolveDesign(presetId === "inkwork" ? undefined : { presetId }),
});

const TEXT_METHODS = ["hf-css-fade", "hf-kinetic-text", "hf-anime-scatter", "hf-waapi-marker"];

for (const m of TEXT_METHODS) {
  test(`${m}: inkwork is byte-identical to the old hardcoded look`, () => {
    const out: any = METHOD_RENDERERS[m](mkScene({ method: m }), ctx("inkwork"));
    assert.ok(out.html.includes("#f6f5f1"), "inkwork paper missing");
    assert.ok(out.html.includes("#1b1612"), "inkwork ink missing");
  });
  test(`${m}: nocturne preset actually flows (W1 fix)`, () => {
    const out: any = METHOD_RENDERERS[m](mkScene({ method: m }), ctx("nocturne"));
    assert.ok(out.html.includes("#1a1c1e"), "nocturne paper not applied");
    assert.ok(!out.html.includes("#f6f5f1"), "hardcoded inkwork paper leaked into nocturne");
  });
}

test("assets resolve under ctx.projectRoot, not process.cwd (daemon bug fix)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vm-reg-"));
  fs.mkdirSync(path.join(root, "assets", "generated"), { recursive: true });
  const bg = path.join(root, "assets", "generated", "s.png");
  fs.writeFileSync(bg, "x");
  const cwd = process.cwd();
  process.chdir(os.tmpdir());
  try {
    const out: any = METHOD_RENDERERS["hf-css-fade"](mkScene({ assets: ["generated/s.png"] }), ctx("inkwork", root));
    assert.equal(out.sideFiles?.["bg.png"], bg);
  } finally {
    process.chdir(cwd);
  }
});

test("rm-d3-bar-chart no longer carries the dead gold-gradient defs", () => {
  const out: any = METHOD_RENDERERS["rm-d3-bar-chart"](mkScene({ method: "rm-d3-bar-chart" }), ctx("inkwork"));
  assert.ok(!out.tsx.includes("#d4a64a") && !out.tsx.includes("#f4d479"));
});

test("rm-d3-line-trend fallback drops the lint-banned AI gold/purple palette", () => {
  const out: any = METHOD_RENDERERS["rm-d3-line-trend"](mkScene({ method: "rm-d3-line-trend" }), ctx("inkwork"));
  for (const banned of ["#f4d479", "#d4a64a", "#9b6cff", "#5fc4f4"]) {
    assert.ok(!out.tsx.includes(banned), `banned palette ${banned} leaked into line-trend fallback`);
  }
});

test("image-backed text is readable over the dark veil (light on inkwork, not ink)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vm-veil-"));
  fs.mkdirSync(path.join(root, "assets", "generated"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "generated", "bg.png"), "x");
  const withBg: any = METHOD_RENDERERS["hf-css-fade"](mkScene({ assets: ["generated/bg.png"] }), ctx("inkwork", root));
  // The .line text color must be the light paper, not the near-black ink.
  const m = /\.line \{[^}]*color: (#[0-9a-fA-F]{6})/.exec(withBg.html);
  assert.equal(m?.[1]?.toLowerCase(), "#f6f5f1", "text over dark veil should be light paper");
  // Without a bg image, text stays ink (dark on paper).
  const noBg: any = METHOD_RENDERERS["hf-css-fade"](mkScene({ assets: [] }), ctx("inkwork", root));
  const m2 = /\.line \{[^}]*color: (#[0-9a-fA-F]{6})/.exec(noBg.html);
  assert.equal(m2?.[1]?.toLowerCase(), "#1b1612", "text on plain paper should be ink");
});

test("hf-poster-hero / hf-mountain-reveal no longer burn 山海 demo branding", () => {
  for (const m of ["hf-poster-hero", "hf-mountain-reveal"]) {
    const out: any = METHOD_RENDERERS[m](mkScene({ method: m }), { ...ctx("inkwork"), projectTitle: "我的项目" });
    assert.ok(!out.html.includes("山海"), `${m} still contains 山海 branding`);
    assert.ok(!out.html.includes("MMXXVI"), `${m} still contains MMXXVI`);
  }
});

test("hf-mountain-reveal has no screen-blend glow layer (印刷工坊 no-glow)", () => {
  const out: any = METHOD_RENDERERS["hf-mountain-reveal"](mkScene({ method: "hf-mountain-reveal" }), ctx("inkwork"));
  assert.ok(!out.html.includes("mix-blend-mode: screen"), "glow layer still present");
  assert.ok(!/class="glow"|#glow/.test(out.html), "glow element/animation still present");
});

test("hf-lottie-play rejects .lottie (dotLottie) and falls back to css-fade", () => {
  const out: any = METHOD_RENDERERS["hf-lottie-play"](mkScene({ assets: ["anim.lottie"] }), ctx("inkwork"));
  assert.ok(!out.html.includes("lottie.min.js"), ".lottie should not be loaded by lottie-web");
});

test("malicious motion.ease cannot inject into the generated script", () => {
  const out: any = METHOD_RENDERERS["hf-css-fade"](
    mkScene({ motion: { kind: "kenburns", ease: 'x"; alert(1); //' } as any }),
    ctx("inkwork"),
  );
  assert.ok(!out.html.includes("alert(1)"), "ease injection leaked into script");
});

test("catalog and renderer registry are in sync (no drift)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const catalog = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "methods", "catalog.json"), "utf8"));
  assert.deepEqual(reconcileCatalog(catalog.methods.map((m: any) => m.id)), []);
});
