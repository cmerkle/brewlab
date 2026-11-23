# seed-data/ (optional)

A new install with no data opens the first-run setup. If you'd rather start a new install from files — e.g. when moving between servers — put them here (or point `SEED_DIR` at a folder) before the first start:

- `setup.json` — `{ "gear": ["<library gear id>", …], "recipes": ["<recipe template id>", …] }`
- `taste.json` — `{ "palateNotes": "…", "avoidRules": ["cinnamon", "coferment", "funk"] }`, applied once.

The import runs only on the very first start and is idempotent. Restoring a JSON export from the first-run setup is usually easier. See `demo/` for the format of the other files.
