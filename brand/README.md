# Brewlab icon

Source artwork for the app icon: a pour-over dripper over a lab carafe, in front of a small
server rack (Brewlab is self-hosted).

- `icon.svg` — the home-screen icon (full-bleed; iOS/Android round the corners).
- `icon-maskable.svg` — the same, scaled into Android's safe zone for round/squircle masks.
- `favicon.svg` — simplified for browser tabs (no rack, heavier lines).

The PNGs in `src/web/public/` are rendered from these: `icon-512.png`, `icon-192.png`,
`apple-touch-icon.png` (180), `icon-maskable-512.png` (from the maskable SVG) and `favicon.png`
(64, from the favicon SVG). `favicon.svg` is served as-is. After changing them, bump `CACHE` in
`src/web/public/sw.js` so installed apps pick them up.
