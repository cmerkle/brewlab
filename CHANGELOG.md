# Changelog

## Unreleased

- **Duplicate a bag:** Stash → ⋯ → *Duplicate* starts a new bag pre-filled from an existing one, for when you buy more than one bag of a coffee. It copies the name, roaster, origin, process, roast level, roast and purchase dates, size, price, link, notes and photo. The opened and finished dates and the rating start empty. Nothing is saved until you tap Save, so you can change the roast date first.

- **Bag photos from anywhere:** take a photo, choose one from Photos or Files, paste an image (button or ⌘V/Ctrl+V), or drag and drop it on a desktop. It was camera-only before. Images are converted to a JPEG (longest side 2048 px) on the device, so HEIC photos, screenshots and pasted PNGs all work and upload faster. Attaching a photo to an existing bag gets the same options.
- **Look it up online:** after reading the label, a provider with web search finds the coffee on the roaster's own site.
  - The product page is read by the link importer; the AI's own read of the page only fills gaps.
  - It fills only empty fields, shows which fields came from the web, and adds the roaster's link.
  - It works with Anthropic, OpenAI and Gemini. There's a manual "Look it up online" button too.
- **Layout audit fix:** a timer left running by an earlier screen could cover the next one. The audit now clears the running brew before the app starts, which removes the long-standing "Save to Brew Log" flake.

- **Kingrinder K6 grind ranges** from the KINGrinder K4/K6 manual: espresso 40–60, AeroPress 60–80, pour-over 80–100 clicks. French press is a single setting (140), so the K6 has no immersion range.
- **More sourced grind ranges.** 12 of the library's grinders now convert out of the box, each from the manufacturer's own chart or manual:
  - 1Zpresso ZP6 Special, K-Ultra, J-Max, JX and Q2 (1Zpresso's grind setting charts);
  - Timemore C2 and C3 (Timemore manual);
  - Niche Zero (Niche's grind size guide);
  - Breville Smart Grinder Pro (instruction book);
  - Fellow Opus 2 (new entry; Fellow's getting-started guide);
  - plus the existing Fellow Ode Gen 2 and Baratza Encore.
- **Still without ranges, because no per-method range from the maker was available:**
  - Comandante C40, Timemore S3, DF64, Eureka Mignon: no official per-method chart found;
  - Baratza Encore ESP: no chart found yet;
  - Baratza Virtuoso+: single settings, not ranges;
  - Fellow Opus (original): only the Opus 2 guide was found.
- **ZP6 settings are dial numbers now**, as 1Zpresso labels them ("setting 4.5"), not rotations. The JX and Q2 use rotations, as their charts do.
- A seed `setup.json` can set per-install `units` as well as `grindRanges`.

- **Suggest to the library:** the gear editor turns custom gear into a ready-to-submit library entry, or proposes your grind ranges for a library model. It's checked with the same rules as CI and comes with Copy, Download and "Open on GitHub" (a pre-filled new file).
- **Stricter library rules**, shared by the app, tests and CI (`npm run check:catalog`): cited https sources only, ranges inside the grinder's min/max, type ↔ category consistency, plain-English errors.
- Pull-request template for library contributions.

## 0.1.0 — first public release

- Brew: recipes with a guided timer, ratio calculator, grind guide and grind converter (positional, per brew method), stash, brew log, gear.
- Gear & recipe library as data (`catalog/`): pick your gear, or add your own; grind ranges only with a cited source.
- First-run setup: your brewers and grinders (with a calibration helper for unlisted grinders), units (g/oz, °C/°F), starter recipes that fit your gear, demo data, restore from an export.
- Discover: weekly board that starts with popular picks and learns from your ratings; optional AI provider (Anthropic, OpenAI, Gemini, OpenAI-compatible) set in the app with a write-only key; avoid-rule toggles and suggestions; optional taste quiz.
- Installable PWA; nightly backups and JSON export.
