#!/usr/bin/env node
// Checks the gear & recipe library (catalog/) with the same rules the app uses, and explains
// every problem in plain words. Run: npm run check:catalog   (CI runs it on every pull request)
import fs from "node:fs";
import path from "node:path";

const { loadCatalog, CATALOG_DIR } = await import(new URL("../dist/server/catalog.js", import.meta.url));
const c = loadCatalog(CATALOG_DIR, true);
const problems = [...c.errors];

// Templates must point at real gear, and gear ids must be unique case-insensitively.
const ids = new Set(c.gear.map((g) => g.id));
for (const t of c.recipes) {
  for (const id of [...t.brewer.ids, ...t.grind.preferredGrinders])
    if (!ids.has(id)) problems.push(`recipes/${t.id}.json: refers to gear "${id}", which isn't in catalog/gear/`);
  if (!t.brewer.ids.length && !t.brewer.categories.length) problems.push(`recipes/${t.id}.json: brewer needs ids or categories`);
}
const seen = new Map();
for (const f of fs.readdirSync(path.join(CATALOG_DIR, "gear"))) {
  const k = f.toLowerCase();
  if (seen.has(k)) problems.push(`gear/${f}: same id as gear/${seen.get(k)} (ids are case-insensitive)`);
  seen.set(k, f);
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) in the library:\n  - ${problems.join("\n  - ")}\n\nSee CONTRIBUTING.md for the format and the rules.`);
  process.exit(1);
}
const withRanges = c.gear.filter((g) => g.grindRanges).length;
console.log(`✓ Library OK: ${c.gear.length} gear (${withRanges} with sourced grind ranges), ${c.recipes.length} recipe templates.`);
