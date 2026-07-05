import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema, SUPPORTED_KEYWORDS, IGNORED_KEYWORDS } from "./schema.ts";
import { mkStoryboard } from "./_testkit.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(here, "..", "schemas", "storyboard.schema.json"), "utf8"));

test("schema uses no keyword the validator silently ignores (drift guard)", () => {
  const unsupported: string[] = [];
  const walk = (node: any, at: string) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(key) && !IGNORED_KEYWORDS.has(key)) unsupported.push(`${at}.${key}`);
    }
    if (node.properties) for (const [k, sub] of Object.entries(node.properties)) walk(sub, `${at}.properties.${k}`);
    if (node.items) walk(node.items, `${at}.items`);
  };
  walk(schema, "$");
  assert.deepEqual(unsupported, [], `schema.json uses keyword(s) the validator ignores → would silently weaken validation: ${unsupported.join(", ")}`);
});

test("valid storyboard passes with zero errors", () => {
  assert.deepEqual(validateSchema(mkStoryboard(), schema), []);
});

test("project.width as string is rejected", () => {
  const sb: any = mkStoryboard();
  sb.project.width = "1080";
  const errs = validateSchema(sb, schema);
  assert.ok(errs.some((e) => e.path.includes("width")), JSON.stringify(errs));
});

test("non-integer width is rejected (integer keyword)", () => {
  const sb: any = mkStoryboard();
  sb.project.width = 1080.5;
  assert.ok(validateSchema(sb, schema).some((e) => e.path.includes("width")));
});

test("fps over max is rejected", () => {
  const sb: any = mkStoryboard();
  sb.project.fps = 200;
  assert.ok(validateSchema(sb, schema).some((e) => e.path.includes("fps")));
});

test("bad transition enum is rejected", () => {
  const sb: any = mkStoryboard();
  sb.scenes[0].transition = "zoom";
  assert.ok(validateSchema(sb, schema).some((e) => e.path.includes("transition")));
});

test("empty scenes array is rejected (minItems)", () => {
  const sb: any = mkStoryboard();
  sb.scenes = [];
  assert.ok(validateSchema(sb, schema).some((e) => e.path.includes("scenes")));
});

test("missing required stages block is rejected", () => {
  const sb: any = mkStoryboard();
  delete sb.stages;
  assert.ok(validateSchema(sb, schema).some((e) => e.path.includes("stages")));
});

test("unknown optional field is allowed (schemas evolve)", () => {
  const sb: any = mkStoryboard();
  sb.project.somethingNew = 42;
  assert.deepEqual(validateSchema(sb, schema), []);
});
