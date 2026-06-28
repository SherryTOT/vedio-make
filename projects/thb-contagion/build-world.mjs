// Builds a compact world.js (window.__WORLD) from Natural Earth 110m countries.
// countries: array of polygon rings (each ring = flat [lon,lat,...] rounded) for outlines.
// thailand: rings for the highlighted fill.
import { readFileSync, writeFileSync } from "node:fs";

const g = JSON.parse(readFileSync(new URL("./ne_110m.geojson", import.meta.url)));
const r = (n) => Math.round(n * 100) / 100;

function ringsOf(feature) {
  const out = [];
  const geom = feature.geometry;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      const flat = [];
      for (const [lon, lat] of ring) flat.push(r(lon), r(lat));
      if (flat.length >= 6) out.push(flat);
    }
  }
  return out;
}

const countries = [];
let thailand = [];
for (const f of g.features) {
  const rings = ringsOf(f);
  for (const ring of rings) countries.push(ring);
  if (f.properties.NAME === "Thailand") thailand = rings;
}

const payload = { countries, thailand };
const js = "window.__WORLD=" + JSON.stringify(payload) + ";\n";
writeFileSync(new URL("./world.js", import.meta.url), js);
console.log(
  "world.js written:",
  (js.length / 1024).toFixed(0) + "KB",
  "| country rings:",
  countries.length,
  "| thailand rings:",
  thailand.length,
);
