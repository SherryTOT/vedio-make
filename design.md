# Design system

## Palette

- Background: `#050308` deep night, `#0a0612` to `#02010a` gradient
- Primary text: `#f4ead0` cream
- Gold accent: `#d4a64a` solid, `#f4d479 → #c98f2e` highlight gradient
- Purple accent: `#3a1d6d` to `#1e0e3c`
- Muted: `rgba(244,234,208,0.45)`

## Typography

- Sans (default): system / "PingFang SC" / "Source Han Sans SC" — for Chinese, body, captions
- Display: same sans, weight 500, letter-spacing 0.04em — for hero phrases
- Mono: `ui-monospace` / Menlo — for numbers and timestamps

## Motion

- Eases: `power3.out` / `back.out(1.5)` / `sine.inOut` (mix at least 3 per scene)
- Stagger: 80-160 ms between sibling elements
- Pulse / breath: 6-10% scale, 0.6-1.2 s duration
- Camera (3D scenes): rotationY ±25°, rotationX ±12°, perspective 1400 px set via GSAP transformPerspective

## Frame composition

- Default size: 1920 × 1080, 30 fps
- Safe area: 120 px horizontal padding, 80 px top/bottom
- No solid full-screen gradients on dark backgrounds — use radial pools instead

## Don'ts

- No `Math.random()` or `Date.now()` in animations (must be deterministic)
- No `repeat: -1` on GSAP timelines
- No `<br>` for line breaks — let text wrap via max-width
