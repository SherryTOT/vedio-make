/**
 * Minimal, dependency-free JSON-Schema-subset validator.
 *
 * The repo ships ZERO runtime deps on purpose, so instead of pulling in ajv we
 * validate the storyboard against a hand-written schema with just the keywords
 * we actually use: type (incl. unions + "null"), required, properties, items,
 * enum, minimum, minItems, minLength. Unknown properties are ALLOWED (schemas
 * evolve; we don't want to reject a storyboard for a new optional field).
 *
 * Returns a list of { path, msg } errors; empty = valid.
 */
export interface SchemaError { path: string; msg: string }

/** Validation keywords this minimal validator actually ENFORCES. */
export const SUPPORTED_KEYWORDS = new Set([
  "type", "enum", "minimum", "maximum", "minLength", "required", "properties", "items", "minItems",
]);
/** Structural/meta keys allowed in the schema but not themselves checks. */
export const IGNORED_KEYWORDS = new Set([
  "$schema", "$id", "title", "description", "additionalProperties", "default", "examples",
]);

type JsonSchema = any;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v; // "object" | "string" | "number" | "boolean" | "undefined"
}

function typeMatches(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  if (t === "integer") return actual === "integer";
  return actual === t;
}

export function validateSchema(data: unknown, schema: JsonSchema, path = "$"): SchemaError[] {
  const errs: SchemaError[] = [];
  if (!schema || typeof schema !== "object") return errs;

  // type
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t: string) => typeMatches(data, t))) {
      errs.push({ path, msg: `期望类型 ${types.join("|")},实际 ${typeOf(data)}` });
      return errs; // wrong type → downstream checks are meaningless
    }
  }

  // enum
  if (schema.enum && !schema.enum.includes(data as any)) {
    errs.push({ path, msg: `值应为 ${JSON.stringify(schema.enum)} 之一,实际 ${JSON.stringify(data)}` });
  }

  // numbers
  if (typeof data === "number") {
    if (typeof schema.minimum === "number" && data < schema.minimum) errs.push({ path, msg: `应 ≥ ${schema.minimum},实际 ${data}` });
    if (typeof schema.maximum === "number" && data > schema.maximum) errs.push({ path, msg: `应 ≤ ${schema.maximum},实际 ${data}` });
  }

  // strings
  if (typeof data === "string" && typeof schema.minLength === "number" && data.length < schema.minLength) {
    errs.push({ path, msg: `字符串长度应 ≥ ${schema.minLength}` });
  }

  // objects
  if (typeOf(data) === "object") {
    const obj = data as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (!(req in obj) || obj[req] === undefined) errs.push({ path: `${path}.${req}`, msg: "缺少必填字段" });
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries<JsonSchema>(schema.properties)) {
        if (key in obj && obj[key] !== undefined) errs.push(...validateSchema(obj[key], sub, `${path}.${key}`));
      }
    }
  }

  // arrays
  if (Array.isArray(data)) {
    if (typeof schema.minItems === "number" && data.length < schema.minItems) errs.push({ path, msg: `数组应 ≥ ${schema.minItems} 项` });
    if (schema.items) data.forEach((el, i) => errs.push(...validateSchema(el, schema.items, `${path}[${i}]`)));
  }

  return errs;
}
