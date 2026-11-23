# Contributing

Thanks for helping! The most useful contributions are **gear** and **grind ranges** — they're plain JSON, no code.

## The easy way: from the app

Add the gear to your own Brewlab (Gear → "+" → *Add custom gear*), fill in its details and Kind, and save. Then, in its editor:

- **Suggest this gear to the library…** turns custom gear into a library entry.
- **Suggest a change to the gear library…** (on gear you added from the library) proposes your grind ranges for that entry.

Brewlab checks the entry with the same rules as CI, tells you what's missing (usually a source link for grind ranges), and gives you **Copy**, **Download**, and **Open on GitHub** — which opens a new file in this repo with the entry filled in, so "Propose new file" makes the pull request. Nothing is sent from your Brewlab.

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

## What CI checks

`npm run check:catalog` (CI runs it on every pull request) explains each problem in plain words:

- the file is valid JSON matching the format, and its `id` matches the file name (ids are unique);
- grind ranges have `rangeInfo` with `confidence` `manufacturer` or `community` and an **https** `source` — drafts aren't accepted;
- each range has low ≤ high and sits inside the grinder's `min`/`max`;
- `type` and `category` agree (grinder ↔ `*-grinder`), only grinders have ranges, only brewers have `defaultMethod`;
- recipe templates only refer to gear that exists.

## Before you open a pull request

```bash
npm ci && npm run build && npm run check:catalog && npm run typecheck && npm test
```

`npm test` also checks that no gear is hardcoded in `src/` and that no personal data slipped into the repo.

For code changes, run the end-to-end checks in `tests/e2e` too (see the README).
