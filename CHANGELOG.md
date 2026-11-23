# Changelog

## Unreleased

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
