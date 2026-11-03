import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFfmpegFilters, ffmpegChecks, keyChecks, engineChecks, findNpxPackage, nodeCheck, summarize } from "./doctor.ts";
import { hasProviderKey } from "./providers/shared.ts";

// Trimmed `ffmpeg -filters` output from a build WITHOUT libass/drawtext (the Homebrew-minimal case).
const LISTING = `Filters:
  T.. = Timeline support
 ------
 .. adelay            A->A       Delay one or more audio channels.
 T. afade             A->A       Fade in/out input audio.
 .. amix              N->A       Audio mixing.
 .. apad              A->A       Pad audio with silence.
 .. volumedetect      A->A       Detect audio volume.
 T. signalstats       V->V       Generate statistics from video analysis.
 .. scale             V->V       Scale the input video size and/or convert the image format.
 .. fps               V->V       Force constant framerate.
 .. xfade             VV->V      Cross fade one video with another video.
`;

test("parseFfmpegFilters reads filter names and ignores the legend", () => {
  const f = parseFfmpegFilters(LISTING);
  assert.ok(f.has("xfade") && f.has("signalstats") && f.has("amix"));
  assert.equal(f.has("Timeline"), false);
  assert.equal(f.has("subtitles"), false);
});

test("missing libass/drawtext is a warning (optional features), not a render failure", () => {
  const c = ffmpegChecks(LISTING);
  assert.equal(c.find((x) => x.name === "必需滤镜")!.status, "ok");
  assert.equal(c.find((x) => x.name === "subtitles")!.status, "warn");
  assert.equal(c.find((x) => x.name === "drawtext")!.status, "warn");
});

test("no ffmpeg, or a required filter missing, fails the doctor", () => {
  assert.equal(ffmpegChecks(null)[0].status, "fail");
  const c = ffmpegChecks(LISTING.replace(/^.*xfade.*$/m, ""));
  assert.equal(c[0].status, "fail");
  assert.match(c[0].detail, /xfade/);
});

test("key checks report presence only — the key value never appears in the output", () => {
  const secret = "sk-doctor-test-should-never-print-1234";
  process.env.TAVILY_API_KEY = secret;
  try {
    const checks = keyChecks(hasProviderKey, ["tavily"]);
    assert.equal(checks[0].status, "ok");
    assert.equal(JSON.stringify(checks).includes(secret), false);
    assert.equal(summarize(checks).text.includes(secret), false);
  } finally {
    delete process.env.TAVILY_API_KEY;
  }
});

test("engine cache: finds the pinned hyperframes in the npx cache; absent cache is a warning with the download size", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vm-doctor-"));
  let c = engineChecks(home);
  assert.ok(c.every((x) => x.status === "warn"));
  assert.match(c[0].detail, /170 MB/);
  const pj = path.join(home, ".npm", "_npx", "abc123", "node_modules", "hyperframes", "package.json");
  fs.mkdirSync(path.dirname(pj), { recursive: true });
  fs.writeFileSync(pj, JSON.stringify({ name: "hyperframes", version: "0.6.7" }));
  fs.mkdirSync(path.join(home, ".cache", "puppeteer", "chrome-headless-shell"), { recursive: true });
  assert.equal(findNpxPackage("hyperframes@0.6.7", path.join(home, ".npm", "_npx")), path.dirname(pj));
  assert.equal(findNpxPackage("hyperframes@0.5.7", path.join(home, ".npm", "_npx")), null);
  c = engineChecks(home);
  assert.ok(c.every((x) => x.status === "ok"));
});

test("summary exits non-zero only when something blocks rendering", () => {
  assert.equal(summarize([nodeCheck("22.1.0"), { group: "key", name: "x", status: "warn", detail: "" }]).exitCode, 0);
  assert.equal(summarize([nodeCheck("16.20.0")]).exitCode, 1);
});
