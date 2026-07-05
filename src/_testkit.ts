// Shared test fixtures. NOT a *.test.ts file, so the node:test runner won't
// execute it directly — it's imported by the colocated *.test.ts suites.
import type { Storyboard, Scene } from "./types.ts";

/** A minimal storyboard that satisfies schemas/storyboard.schema.json's required
 *  set. Pass overrides to mutate scenes/project for a specific assertion. */
export function mkStoryboard(over: Partial<Storyboard> = {}): Storyboard {
  const base: Storyboard = {
    source: "test.srt",
    project: { title: "T", width: 1080, height: 1920, fps: 30, design: { presetId: "inkwork" } },
    scenes: [mkScene({ index: 1, startSec: 0, endSec: 3, durationSec: 3 })],
    stages: { parsed: true, analyzed: true, approved: true, rendered: false },
  } as Storyboard;
  return { ...base, ...over } as Storyboard;
}

export function mkScene(over: Partial<Scene> = {}): Scene {
  return {
    index: 1, startSec: 0, endSec: 3, durationSec: 3,
    text: "示例文案", method: "hf-css-fade",
    ...over,
  } as Scene;
}
