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

| File | When to use |
|---|---|
| `科普风.md` | Educational explainers, tech tutorials, science content. Calm pacing, data-friendly, gold accent. |
| `商业风.md` | Pitch decks, product demos, corporate explainers. Tight stagger, blue accent, no whimsy. |
| `情感叙事.md` | Documentary / memoir / brand stories. Slow camera, dip-to-black, serif heroes, voice variety. |

## Anatomy of a preset

Each preset declares:
- **Palette** — colors the renderer should pull from
- **Typography** — font families, weights, letter-spacing
- **Motion** — ease curves, stagger, camera intensity bias
- **Method preference** — which methods the analyzer should favor / avoid
- **Voice** — default voice + variety guidelines
- **Don'ts** — explicit anti-patterns

These flow into the analyzer's system prompt (via `pipeline analyze`), which
treats `design.md` as authoritative context.

## Writing your own preset

Just match the section structure. The analyzer reads the markdown verbatim;
clearer rules → more predictable picks.
