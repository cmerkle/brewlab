# Seed data (optional)

A new install with no data opens the first-run setup, which is the usual way to start. Seed files are for starting a **new** install from files instead, for example a scripted setup or the same gear on several servers. To move an existing Brewlab, restoring a JSON export from the first-run setup is easier.

## Using it with Docker

Put the files in a folder of your own, mount it read-only and point `SEED_DIR` at it. In `docker-compose.override.yml`:

```yaml
services:
  brewlab:
    environment:
      SEED_DIR: /seed
    volumes:
      - ./my-seed:/seed:ro
```

Files placed in this `seed-data/` folder only reach the app if you build the image yourself (`docker compose up -d --build`).

The seed is imported **only on the very first start** of an empty install. After that, the database holds everything and the files are ignored. Importing is idempotent: rows are matched by `id`, so nothing is duplicated. A seeded install counts as set up, so the first-run setup is skipped; you can run it later from More → Settings → Run setup again.

## Files

All files are optional.

- **`setup.json`**: gear and starter recipes from the library.
  ```json
  {
    "gear": ["hario-v60-02", "comandante-c40"],
    "recipes": ["hoffmann-v60"],
    "grindRanges": { "comandante-c40": { "step": 1, "methods": { "pourover": { "low": 22, "high": 28 } } } },
    "units": { "comandante-c40": "clicks" }
  }
  ```
  - `gear` and `recipes` are ids from `catalog/gear/` and `catalog/recipes/`.
  - `grindRanges` (optional) are your own ranges for a grinder. They are used only when the grinder is first added, and later edits in the app are kept.
  - `units` (optional) overrides a grinder's unit word.
- **`taste.json`**: applied once, then edited in the app.
  ```json
  { "palateNotes": "Bright, fruity filter coffee; no dark roasts.", "avoidRules": ["cinnamon", "dark-roast"] }
  ```
  `avoidRules` are ids of the starter "always leave out" rules: `cinnamon`, `coferment`, `funk`, `decaf`, `dark-roast`, `blends`, `robusta`, `smoky`.
- **`water.json`**: water recipes, from the library by id or written out in full. Recipes and brews link to them with `waterId`.
  ```json
  { "water": [{ "id": 1, "library": "lotus-rao-perger" }, { "id": 2, "name": "My soft water", "baseId": "distilled", "volume": 1, "volumeUnit": "L", "additives": [{ "additiveId": "epsom-salt", "name": "Epsom salt", "amount": 0.1, "unit": "g" }] }] }
  ```
- **`assistant-inventory.json`** (bags in the Stash), **`assistant-recipes.json`** (your own recipes), **`assistant-brews.json`** (the brew log) and **`recommendations-board.json`** (a Discover board). `demo/` has an example of each format except recipes, with fictional data.
