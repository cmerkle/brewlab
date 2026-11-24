#!/usr/bin/env node
// Checks the gear & recipe library (catalog/) with the same rules the app uses, and explains
// every problem in plain words. Run: npm run check:catalog   (CI runs it on every pull request)
import fs from "node:fs";
import path from "node:path";

const { loadCatalog, loadWaterCatalog, CATALOG_DIR } = await import(new URL("../dist/server/catalog.js", import.meta.url));
const { hardness } = await import(new URL("../dist/shared/water.js", import.meta.url));
const c = loadCatalog(CATALOG_DIR, true);
const w = loadWaterCatalog(CATALOG_DIR, true);
const problems = [...c.errors, ...w.errors];

// A water recipe's published GH/KH must match what its additives add up to (within 10%).
for (const t of w.recipes) {
  const h = hardness({ baseId: t.base, volume: t.volume, volumeUnit: t.volumeUnit, additives: t.additives.map((l) => ({ additiveId: l.additive, name: l.additive, amount: l.amount, unit: l.unit })) }, w);
  for (const k of ["gh", "kh"]) {
    const said = t.stated?.[k];
    if (said == null || h[k] == null) continue;
    if (Math.abs(h[k] - said) > Math.max(2, said * 0.1)) problems.push(`water/${t.id}.json: the source says ${k.toUpperCase()} ${said}, the additives add up to ${h[k]}`);
  }
}

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
console.log(`✓ Library OK: ${c.gear.length} gear (${withRanges} with sourced grind ranges), ${c.recipes.length} recipe templates, ${w.recipes.length} water recipes (${w.additives.length} additives).`);
