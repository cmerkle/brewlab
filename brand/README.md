# Brewlab logo

A pour-over dripper over a carafe whose base is a small server (Brewlab is self-hosted).

**Sources (hand-made):**
- `brewlab-refined-symbol.svg` — the symbol on a transparent background. Everything below is built from it.
- `brewlab-refined-icon.svg` — the original square icon layout.

**Generated** by `tools/build.py` (run it after changing the symbol):
- `icon.svg` — home-screen icon (full-bleed; iOS/Android round the corners). Optically centred:
  halfway between the outline's centre and the visual weight, which sits low (the carafe and base).
- `icon-maskable.svg` — smaller, inside Android's 80% safe circle.
- `favicon.svg` — fills the browser-tab icon.
- `brewlab-refined-header.svg` / `brewlab-refined-header-light.svg` — symbol + "brewlab" for dark /
  light backgrounds. The text is outlines (Nunito ExtraBold, SIL Open Font License), so it looks
  the same everywhere and needs no font.
- `../src/web/Logo.tsx` — the same wordmark inline in the app; its colours come from the theme
  (`.wordmark .lg-*` in styles.css).

To regenerate: `pip install fonttools`, download `Nunito[wght].ttf` from
github.com/google/fonts (ofl/nunito), then
`python3 tools/outline.py Nunito[wght].ttf /tmp/brewlab-wordmark.json && python3 tools/build.py /tmp/brewlab-wordmark.json`.
Render the PNGs in `src/web/public/` (icon-512/192, apple-touch-icon 180, icon-maskable-512,
favicon 64) from the SVGs, copy `favicon.svg` there, and bump `CACHE` in `src/web/public/sw.js`
so installed apps pick them up.
