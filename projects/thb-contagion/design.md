# Design — 多米诺骨牌 / Dominoes contagion globe

Faithful replica of 小Lin说《一口气了解亚洲金融危机》@ 18:23 — dark 3D contagion globe.

## Palette

- bg.deep `#04050a` — near-black canvas
- bg.redCorner `#3a0c0c` — deep red ambient bloom in screen corners
- ocean `#07120f` — globe base / sea
- land `#143029` — dark teal landmass fill
- border `rgba(150,220,190,0.20)` — faint country outlines
- hk.red `#ff3a1e` / hk.core `#ffd8b0` — Hong Kong hotspot (hot, pulsing)
- th.orange `#ffae3a` / th.fill `#b9842b` — Thailand hotspot + country fill
- jp.gold `#ffd27a` — Japan dot
- arc.gold `#ffb45a` — Hong Kong → Japan great-circle arc
- attack.red `#ff2e2e` — incoming speculative-attack streaks
- card.maroon `#3a0f14` / card.border `#5d1d24` — left chapter card panel
- card.tag `#ff5a7a` — "97-99" pink tag
- ruler.tick `#7a7a84` / ruler.text `#9a9aa4` / ruler.head `#ff4a3a` — bottom year timeline
- bili.pink `#fb7299` — bilibili watermark
- text.fg `#ffffff` — subtitle / labels

## Type

`'PingFang SC','Noto Sans SC','Source Han Sans SC','Microsoft YaHei',sans-serif`
Weights 600–800. Subtitle ~46px bold with dark shadow. Big card title ~40px 800.

## Motion

- Globe: slow auto-rotation (~0.012 rad/s) + gentle camera push-in.
- Hotspots: breathing pulse (HK ~1.1s urgent, Thailand ~1.8s).
- Arc: draw-on then a flowing highlight head.
- Attack streaks: periodic red rays sweeping from screen-top into Hong Kong.
- Duration 6.0s, 1920×1080, 30fps.
