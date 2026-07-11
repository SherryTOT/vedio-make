# Design Presets

Drop-in `design.md` files for common video genres. The analyzer reads
`design.md` at project root and adjusts method/motion/voice picks accordingly.

To use a preset:

```bash
# Either copy directly:
cp design-presets/科普风.md design.md

# Or symlink (lets you switch styles by re-symlinking):
ln -sf design-presets/商业风.md design.md
```

## Bundled presets

| File | When to use | 设计预设 |
|---|---|---|
| `科普风.md` | Educational explainers, tech tutorials, science content. Calm, data-friendly. | `nocturne` (alt `swiss`) |
| `商业风.md` | Pitch decks, product demos, corporate explainers. Tight, decisive. | `swiss` (alt `magazine`) |
| `情感叙事.md` | Documentary / memoir / brand stories. Slow, warm, serif heroes, voice variety. | `claywarm` (alt `inkwork`) |

## Anatomy of a preset（叙事调性档，非视觉档）

A preset is a **narrative-tonality doc** — it says how the film is *told*, never
how it *looks*. The look lives entirely in the design tokens. Each preset declares:

- **设计预设** — one of the 5 preset ids (`inkwork` / `swiss` / `magazine` /
  `nocturne` / `claywarm`). This is the ONLY visual field; colour, type, and light
  come from `src/methods/designs.ts` tokens, never from this doc.
- **风格档案** — which DIRECTION §二 archive (A 极客湾式 / B 小Lin说式 / C 印刷工坊经典).
- **节奏密度** — visual-event cadence + tempo (`deliberate` / `snappy` / `gentle`).
- **语气 / 目标观众** — voice of the narration + who it's for.
- **方法偏好** — semantic method leanings that map through DIRECTION §一.
- **配音** — default voice + variety guidelines.
- **Don'ts** — behavioural anti-patterns (the print-workshop visual red lines are
  global, in MOTION.md §一 — not repeated per preset).

These flow into the analyzer's system prompt (via `pipeline analyze`), which reads
`design.md` verbatim as authoritative context.

## Writing your own preset

Match the section structure above. **Never write hex colours, fonts, eases, or
camera values here** — pick a `设计预设` id and describe tone/rhythm/voice. The
analyzer reads the markdown verbatim; clearer tonality rules → more predictable
method and voice picks.
