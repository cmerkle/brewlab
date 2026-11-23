# Contributing

Thanks for helping! The most useful contributions are **gear** and **grind ranges** — they're plain JSON, no code.

## Add gear to the library

One file per model in `catalog/gear/<id>.json` (the `id` must match the file name, lowercase with dashes):

```json
{
  "id": "acme-hand-grinder",
  "version": 1,
  "name": "Acme Hand Grinder",
  "brand": "Acme",
  "type": "grinder",
  "category": "hand-grinder",
  "details": "Hand grinder; settings counted in clicks from zero.",
  "units": "clicks"
}
```

- `type`: `grinder`, `brewer` or `other`.
- `category`: one of `hand-grinder`, `electric-grinder`, `cone-dripper`, `flat-bottom-dripper`, `hybrid-dripper`, `immersion-dripper`, `aeropress`, `rapid-brewer`, `french-press`, `moka-pot`, `espresso-machine`, `batch-brewer`, `other`. Recipe templates match brewers by category.
- Brewers can set `defaultMethod` (`espresso`, `pourover`, `immersion`, `aeropress`, `rapid`, `batch`) and `variants`.

## Grind ranges need a source

A grinder may include `grindRanges` — the low/high setting **per brew method** — only with a `rangeInfo` that says where they came from:

```json
"grindRanges": {
  "scale": "settings 1–40", "min": 1, "max": 40, "step": 1,
  "methods": { "pourover": { "low": 13, "high": 14 }, "espresso": { "low": 2, "high": 6 } }
},
"rangeInfo": { "confidence": "manufacturer", "source": "https://…", "note": "What the source says, quoted." }
```

- `confidence`: `manufacturer` (the maker's manual, chart or site) or `community` (a published community chart). Both **must** cite a `source` URL.
- Transcribe what the source says per brew method. Don't convert microns or size bands into methods yourself — if the source doesn't name methods, leave the ranges out.
- Bump `version` when you change an existing entry; installed copies are offered the update, never overwritten.

## Recipe templates

`catalog/recipes/<id>.json`. The grind is a **position** (0–1) inside the method's range on the user's grinder, so one template works on any grinder with ranges. Templates name the brewers they fit by library id and/or category.

## Before you open a pull request

```bash
npm ci && npm run build && npm run typecheck && npm test
```

`npm test` validates every library file (schema, ordered ranges, a source for every range) and checks that no gear is hardcoded in `src/`.

For code changes, run the end-to-end checks in `tests/e2e` too (see the README).
