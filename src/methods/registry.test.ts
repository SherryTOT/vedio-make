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

// ── hf-mega-counter (P1 §三.3) ──

test("hf-mega-counter: rolls to value, tabular-nums + power4.out, tokens not hardcoded", () => {
  const d = resolveDesign(undefined);
  const out: any = METHOD_RENDERERS["hf-mega-counter"](
    mkScene({ text: "286|%|香港隔夜拆借利率|1997.10|+18%" }), ctx("inkwork"),
  );
  assert.equal(out.engine, "hyperframes");
  assert.ok(out.html.includes('data-duration="3"'), "duration wired");
  assert.ok(out.html.includes("tabular-nums"), "MOTION 红线 5: tabular-nums");
  assert.ok(out.html.includes('ease: "power4.out"'), "spec: count rolls power4.out");
  assert.ok(out.html.includes(d.ink) && out.html.includes(d.accent), "design tokens applied");
  assert.ok(out.html.includes("v: 286"), "target value drives the count-up");
});

test("hf-mega-counter: number is ≥22% height ideal but never overflows the safe area", () => {
  const size = (h: string) => parseInt(/\.num \{ font-size: (\d+)px/.exec(h)![1], 10);
  const short: any = METHOD_RENDERERS["hf-mega-counter"](mkScene({ text: "9|%" }), ctx("inkwork"));
  const long: any = METHOD_RENDERERS["hf-mega-counter"](mkScene({ text: "$1,299,000|起" }), ctx("inkwork"));
  assert.equal(size(short.html), Math.round(1920 * 0.22), "short number hits the 22% ideal");
  assert.ok(size(long.html) < size(short.html), "long number scales down to fit 左右≥120px");
});

test("hf-mega-counter: delta arrow uses ok (up) / alert (down), absent when omitted", () => {
  const d = resolveDesign(undefined);
  const up: any = METHOD_RENDERERS["hf-mega-counter"](mkScene({ text: "10|%|x|y|+5%" }), ctx("inkwork"));
  assert.ok(up.html.includes('class="delta"') && up.html.includes(d.ok), "up delta rides ok colour");
  const down: any = METHOD_RENDERERS["hf-mega-counter"](mkScene({ text: "10|%|x|y|-5%" }), ctx("inkwork"));
  assert.ok(down.html.includes(d.alert), "down delta rides alert colour");
  const none: any = METHOD_RENDERERS["hf-mega-counter"](mkScene({ text: "10|%|x|y" }), ctx("inkwork"));
  assert.ok(!none.html.includes('class="delta"'), "no delta chip without a delta field");
});

test("hf-mega-counter: no emoji glyphs on frame (MOTION 红线 4 — arrow is inline SVG)", () => {
  const out: any = METHOD_RENDERERS["hf-mega-counter"](mkScene({ text: "10|%|x|y|+5%" }), ctx("inkwork"));
  assert.ok(out.html.includes("<svg"), "delta arrow is a vector SVG");
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(out.html), "no emoji in the composition");
});

// ── hf-versus-panel (P1 §三.4) ──

test("hf-versus-panel: A-vs-B table, winner染 accent + slides from opposite edges", () => {
  const dsn = resolveDesign(undefined);
  const out: any = METHOD_RENDERERS["hf-versus-panel"](
    mkScene({ text: "AI Switch|竞品 X\n月费|¥0*|¥99\n模型|全平台*|锁定" }), ctx("inkwork"),
  );
  assert.equal(out.engine, "hyperframes");
  assert.equal((out.html.match(/class="prow"/g) || []).length, 2, "2 param rows parsed");
  assert.ok(out.html.includes(`.pval.win { color: ${dsn.accent}`), "winner cell染 accent");
  assert.ok(out.html.includes(`.col-title.hero { color: ${dsn.accent}`), "hero title染 accent");
  assert.ok(out.html.includes("x: -70") && out.html.includes("x: 70"), "两侧对向滑入");
});

test("hf-versus-panel: supports 3 columns", () => {
  const out: any = METHOD_RENDERERS["hf-versus-panel"](
    mkScene({ text: "开源|Pro|旗舰\n价格|¥0*|¥39|¥99\n并发|1|4*|不限" }), ctx("swiss"),
  );
  assert.equal((out.html.match(/class="col-title/g) || []).length, 3, "3 column titles");
  assert.ok(out.html.includes("repeat(3, 1fr)"), "3-column grid");
});

// ── rm-d3-line-draw (P1 §三.2) ──

test("rm-d3-line-draw: remotion trend that draws itself, primary full / others dim", () => {
  const out: any = METHOD_RENDERERS["rm-d3-line-draw"](
    mkScene({ text: "趋势", data: { years: ["1", "2", "3"], series: [{ name: "a", values: [1, 3, 2] }, { name: "b", values: [2, 2, 2] }] } } as any),
    ctx("inkwork"),
  );
  assert.equal(out.engine, "remotion");
  assert.equal(out.compId, "Scene");
  assert.ok(out.tsx.includes("strokeDashoffset={1 - progress}"), "stroke-dashoffset draw");
  assert.ok(out.tsx.includes("Easing.poly(4)"), "power4.out draw curve");
  assert.ok(out.tsx.includes("opacity={primary ? 1 : 0.35}"), "primary full / others 35%");
});

test("rm-d3-line-draw: font token injected without breaking the tsx string", () => {
  // Regression: ctx.design.sans is double-quoted ("Noto Sans SC", …); injecting it
  // raw into fontFamily: "…" produces fontFamily: ""Noto… — an esbuild parse error.
  const out: any = METHOD_RENDERERS["rm-d3-line-draw"](mkScene({ text: "x" }), ctx("inkwork"));
  assert.ok(!/fontFamily: ""/.test(out.tsx), "no empty-then-bareword font (the bug)");
  assert.ok(/fontFamily: "'[^"]+'/.test(out.tsx), "font names re-quoted to single quotes");
});

// ── rm-d3-bar-race (P1 §三.1) ──

test("rm-d3-bar-race: remotion race, ≤8 bars, power2.inOut reorder, leader/ex-leader colours", () => {
  const dsn = resolveDesign(undefined);
  const many = { years: ["1", "2"], series: Array.from({ length: 12 }, (_, i) => ({ name: "S" + i, values: [i, 12 - i] })) };
  const out: any = METHOD_RENDERERS["rm-d3-bar-race"](mkScene({ text: "race", data: many } as any), ctx("inkwork"));
  assert.equal(out.engine, "remotion");
  assert.equal(out.props.data.series.length, 8, "capped at ≤8 bars");
  assert.ok(out.tsx.includes("Easing.inOut(Easing.quad)"), "y-shift is power2.inOut");
  assert.ok(out.tsx.includes(dsn.accent) && out.tsx.includes(dsn.accent2), "new #1染 accent, ex-#1 accent2");
  assert.ok(!/fontFamily: ""/.test(out.tsx), "font token re-quoted");
});

// ── hf-word-punch (P1 §三.7) ──

test("hf-word-punch: block scaleX sweeps then text lands, accent block / paper text", () => {
  const dsn = resolveDesign(undefined);
  const out: any = METHOD_RENDERERS["hf-word-punch"](mkScene({ text: "金句一\n金句二" }), ctx("inkwork"));
  assert.equal(out.engine, "hyperframes");
  assert.equal((out.html.match(/class="block"/g) || []).length, 2, "two stacked punches");
  assert.ok(out.html.includes("scaleX: 0") && out.html.includes('ease: "power3.out"'), "block scaleX 0→1 power3.out");
  assert.ok(out.html.includes("scale: 1.3"), "text lands scale 1.3→1");
  assert.ok(out.html.includes(`background: ${dsn.accent}`) && out.html.includes(`color: ${dsn.paper}`), "accent block, paper text");
});

test("hf-word-punch: long line scales down to keep the safe area", () => {
  const size = (h: string, i: number) =>
    parseInt(new RegExp(`\\.punch\\[data-i="${i}"\\] \\.txt \\{ font-size: (\\d+)px`).exec(h)![1], 10);
  const out: any = METHOD_RENDERERS["hf-word-punch"](
    mkScene({ text: "短\n这是一句明显更长的金句用来测试自适应缩放不出血" }), ctx("inkwork"),
  );
  assert.ok(size(out.html, 1) < size(out.html, 0), "longer line uses a smaller font");
});

// ── hf-scribble-annotate (P1 §三.6) ──

test("hf-scribble-annotate: flow nodes + hand-drawn arrows draw stroke-by-stroke", () => {
  const dsn = resolveDesign(undefined);
  const out: any = METHOD_RENDERERS["hf-scribble-annotate"](mkScene({ text: "用户 → 网关 → 模型" }), ctx("inkwork"));
  assert.equal(out.engine, "hyperframes");
  assert.equal((out.html.match(/class="node"/g) || []).length, 3, "3 nodes");
  assert.equal((out.html.match(/class="arrow"/g) || []).length, 2, "2 arrows");
  assert.equal((out.html.match(/class="ring"/g) || []).length, 1, "emphasis ring on last node");
  assert.ok(out.html.includes("strokeDashoffset: 1") && out.html.includes("strokeDashoffset: 0"), "逐笔 stroke-draw");
  assert.ok(out.html.includes(`stroke="${dsn.ink}"`) && out.html.includes(`stroke="${dsn.accent}"`), "arrows ink, ring accent");
  assert.ok(!/Math\.random|Date\.now/.test(out.html), "deterministic wobble (seek-safe)");
});

test("hf-scribble-annotate: caps drawn strokes ≤3 (4 nodes → 3 arrows, no ring)", () => {
  const out: any = METHOD_RENDERERS["hf-scribble-annotate"](mkScene({ text: "A -> B -> C -> D" }), ctx("swiss"));
  assert.equal((out.html.match(/class="node"/g) || []).length, 4);
  assert.equal((out.html.match(/class="arrow"/g) || []).length, 3);
  assert.equal((out.html.match(/class="ring"/g) || []).length, 0, "no ring at 4 nodes (keeps drawn ≤3)");
});
