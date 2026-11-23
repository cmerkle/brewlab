# Changelog

## Unreleased

- **Suggest to the library:** the gear editor turns custom gear into a ready-to-submit library entry, or proposes your grind ranges for a library model. It's checked with the same rules as CI and comes with Copy, Download and "Open on GitHub" (a pre-filled new file).
- **Stricter library rules**, shared by the app, tests and CI (`npm run check:catalog`): cited https sources only, ranges inside the grinder's min/max, type ↔ category consistency, plain-English errors.
- Pull-request template for library contributions.

## 0.1.0 — first public release

- Brew: recipes with a guided timer, ratio calculator, grind guide and grind converter (positional, per brew method), stash, brew log, gear.
- Gear & recipe library as data (`catalog/`): pick your gear, or add your own; grind ranges only with a cited source.
- First-run setup: your brewers and grinders (with a calibration helper for unlisted grinders), units (g/oz, °C/°F), starter recipes that fit your gear, demo data, restore from an export.
- Discover: weekly board that starts with popular picks and learns from your ratings; optional AI provider (Anthropic, OpenAI, Gemini, OpenAI-compatible) set in the app with a write-only key; avoid-rule toggles and suggestions; optional taste quiz.
- Installable PWA; nightly backups and JSON export.
