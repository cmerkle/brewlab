# Changelog

## Unreleased

- **Step chime fixes:** the chime now also plays when the timer moves from the first step to the second (it was skipped), it sounds on an iPhone set to silent while the brew timer is open, and unmuting the bell plays it once so you know it's on.

## 0.1.0 — first public release

**Brew**
- Recipes with a guided brew timer: *Brew setup* (dose, water, ratio, temperature, bag, grinder) → *Ready to brew* → *Start timer* when you start pouring → log the brew, with temperature and grind still editable.
- Ratio calculator with 1:13–1:17 and 1:2 quick picks; pour steps scale off the water. Grams or ounces, °C or °F.
- Grind guide and **grind converter**: a setting keeps its position inside one grinder's range for a brew method and lands at the same position on your other grinders. Brew methods run finest → coarsest: Turkish, espresso, moka pot, AeroPress, Rapid Brewer, pour-over, drip coffee maker, French press, cold brew.
- **Grind for a different dose** (More): brewing more or less than the recipe moves the grind by a set share of the range per doubling of the dose. You choose how much and for which methods, or turn it off.
- Stash of bags (derived status: unopened → open → finished, days off roast), duplicate a bag, brew log, tasting notes.
- **Bags from a photo:** take, choose, paste or drop a photo; the label is read by your AI provider or by local OCR, and with a web-search provider the coffee is looked up on the roaster's own site (fills empty fields only and never guesses). Paste a roaster link to import a bag.

**Gear, as data**
- A library of 47 grinders and brewers in `catalog/gear/*.json` and 20 recipe templates in `catalog/recipes/*.json`. Adding one gives you your own editable copy, and library gear and custom gear have exactly the same fields.
- Grinder ranges come from a **cited source** (the maker's chart or a published community chart). Gaps are estimated from the grinder's own ranges by rules that are data (`catalog/estimate-rules.json`) and marked "est.". Each method has a "can do" box, and methods a grinder can't do show "—".
- Gear editor: per-method ranges and notes, dial notation, step and divisor, where the ranges come from, estimated rows, and **Estimate the empty rows**.
- **Suggest to the library:** builds a checked library entry from your gear and opens GitHub's new-file page. Nothing is sent from your Brewlab.

**Discover**
- A weekly board that starts with popular picks and learns from your Stash ratings, brew ratings and tastings.
- Optional AI provider (Anthropic, OpenAI, Gemini, or any OpenAI-compatible server), set in the app with a write-only key. Without one, you add candidates and Brewlab filters and ranks them.
- **Always leave out:** your own rules (a name plus words to look for), starting from suggestions that are all off. An optional taste quiz, and *Your taste* shows exactly what the research is told.

**Everything else**
- First-run setup: your brewers and grinders (with a calibration helper for grinders not in the library), units, starter recipes that fit your gear, demo data (fictional), or restore an export.
- Installable app (PWA) for phones, foldables and desktops; the layout is tested on 15 viewports.
- Nightly database snapshots (newest 14 kept), back up now, and JSON export and restore.
- **More → About:** version, what's new, report a bug (version and device filled in), ask for gear, and an optional daily update check (off by default).
- One Docker container (Node 24, SQLite) for amd64 and arm64: `ghcr.io/cmerkle/brewlab`.
