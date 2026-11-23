// Gear & recipe library (catalog/): validity, template rendering, migration of older installs,
// seeding from a setup.json, and a guard that no gear is hardcoded in src/.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-catalog-"));
process.env.DATA_DIR = tmp;

const { loadCatalog, renderTemplate, catalogRecipe, CATEGORIES } = await import("../dist/server/catalog.js");
const { METHODS } = await import("../dist/shared/grind.js");
const { openDb } = await import("../dist/server/db.js");
const { runSeed, linkGearToCatalog, ownedGear } = await import("../dist/server/seed.js");

const cat = loadCatalog();
// Example grinder ranges, as a fixture: the worked examples don't depend on what the library ships.
const SPEC = JSON.parse(fs.readFileSync("tests/fixtures/spec-grinders.json", "utf8"));
const FULL_SETUP = path.resolve("tests/fixtures/full-setup");
const owned = (ids) => ids.map((id) => {
  const c = cat.gear.find((g) => g.id === id);
  return { id: c.id, name: c.name, type: c.type, category: c.category, units: c.units, grindRanges: SPEC[id]?.grindRanges ?? c.grindRanges ?? null };
});

test("library loads with no errors; templates reference real gear", () => {
  assert.deepEqual(cat.errors, []);
  assert.ok(cat.gear.length >= 16 && cat.recipes.length >= 20);
  const ids = new Set(cat.gear.map((g) => g.id));
  for (const t of cat.recipes) {
    for (const id of [...t.brewer.ids, ...t.grind.preferredGrinders]) assert.ok(ids.has(id), `${t.id} → unknown gear ${id}`);
    assert.ok(t.brewer.ids.length || t.brewer.categories.length, `${t.id} names no brewer`);
  }
});

test("rendering onto the original setup (spec grinder ranges) reproduces the previous starter grind settings", () => {
  const mine = owned(JSON.parse(fs.readFileSync(path.join(FULL_SETUP, "setup.json"), "utf8")).gear);
  const want = {
    "hoffmann-v60": "4.8 rotations", "kasuya-4-6": "5.3 rotations", "work-horse": "5.0 rotations",
    "show-horse-v60-02": "5.0 rotations", "switch-full-immersion": "5.5 rotations", "aiden-batch": "setting 6",
    "french-press-default": "100 clicks", "barista-express-espresso": "15.0", // the DF64's 0.5-step format (old hardcoded text was "15")
    "oxo-soup-shot": "56 clicks (dial 5.6)",
    "aeropress-zuppa-lunga": "50 clicks (dial 5.0)",
  };
  for (const [id, setting] of Object.entries(want)) {
    const r = renderTemplate(catalogRecipe(id), mine);
    assert.equal(r.grindSetting, setting, id);
  }
  const sh = renderTemplate(catalogRecipe("show-horse-v60-03"), mine);
  assert.equal(sh.brewerId, "hario-v60-03");
});

test("a template renders onto someone else's gear (category match, their grinder's units)", () => {
  const theirs = [
    { id: "kalita-wave-185", name: "Kalita Wave 185", type: "brewer", category: "flat-bottom-dripper" },
    { id: "my-v60", name: "Plastic V60", type: "brewer", category: "cone-dripper" },
    { id: "comandante-c40", name: "Comandante C40", type: "grinder", units: "clicks", grindRanges: { step: 1, methods: { pourover: { low: 20, high: 30 } } } },
  ];
  const r = renderTemplate(catalogRecipe("hoffmann-v60"), theirs);
  assert.equal(r.brewerId, "my-v60"); // matched by category, not by the library V60's id
  assert.equal(r.grinderId, "comandante-c40");
  assert.equal(r.grindSetting, "23 clicks"); // position 0.3 inside 20–30
  const noRanges = renderTemplate(catalogRecipe("hoffmann-v60"), [theirs[1], { id: "mystery", name: "Mystery grinder", type: "grinder", units: "clicks", grindRanges: null }]);
  assert.equal(noRanges.grinderId, "mystery");
  assert.equal(noRanges.grindSetting, null); // never invented — the user types it
  const noBrewer = renderTemplate(catalogRecipe("hoffmann-v60"), [theirs[0]]);
  assert.equal(noBrewer.compatible, false);
});

test("older installs are linked to the library; edited ranges are kept", () => {
  const file = path.join(tmp, "old.db");
  const db = openDb(file);
  const t = new Date().toISOString();
  db.prepare("INSERT INTO gear_items (id, name, type, builtin, grindRanges, createdAt, updatedAt) VALUES ('zp6','1Zpresso ZP6','grinder',1,NULL,?,?)").run(t, t);
  const mine = JSON.stringify({ step: 0.1, methods: { pourover: { low: 4, high: 6 } } });
  db.prepare("INSERT INTO gear_items (id, name, type, builtin, grindRanges, createdAt, updatedAt) VALUES ('k6','Kingrinder K6','grinder',1,?,?,?)").run(mine, t, t);
  db.prepare("INSERT INTO gear_items (id, name, type, builtin, createdAt, updatedAt) VALUES ('my-thing','Custom','other',0,?,?)").run(t, t);
  assert.equal(linkGearToCatalog(db), 2);
  const zp6 = db.prepare("SELECT * FROM gear_items WHERE id='zp6'").get();
  assert.equal(zp6.catalogId, "zp6");
  assert.equal(zp6.category, "hand-grinder");
  assert.deepEqual(JSON.parse(zp6.grindRanges), cat.gear.find((g) => g.id === "zp6").grindRanges ?? null); // the library's ranges, whatever it ships
  assert.equal(db.prepare("SELECT grindRanges FROM gear_items WHERE id='k6'").get().grindRanges, mine); // user's edit kept
  assert.equal(db.prepare("SELECT catalogId FROM gear_items WHERE id='my-thing'").get().catalogId, null);
  assert.equal(linkGearToCatalog(db), 0); // idempotent
  db.close();
});

test("fresh install seeds gear and starters from setup.json; re-running adds nothing", () => {
  const db = openDb(path.join(tmp, "fresh.db"));
  runSeed(db, FULL_SETUP);
  runSeed(db, FULL_SETUP);
  const n = (sql) => db.prepare(sql).get().n;
  assert.equal(n("SELECT COUNT(*) n FROM gear_items"), 16);
  assert.equal(n("SELECT COUNT(*) n FROM gear_items WHERE catalogId IS NOT NULL"), 16);
  assert.equal(n("SELECT COUNT(*) n FROM recipes WHERE starter=1"), 20);
  const expected = renderTemplate(catalogRecipe("show-horse-v60-02"), ownedGear(db)).grindSetting;
  assert.equal(db.prepare("SELECT grindSetting FROM recipes WHERE id=1004").get().grindSetting, expected);
  for (const g of ownedGear(db)) assert.deepEqual(g.grindRanges, cat.gear.find((c) => c.id === g.id).grindRanges ?? null, `${g.id} gets the library's ranges`);
  db.close();
});

test("no gear is hardcoded in src/ (library ids never appear as string literals)", () => {
  // Ids that are also a category or brew-method name ("aeropress", "french-press") are vocabulary, not gear.
  const vocab = new Set([...CATEGORIES, ...METHODS]);
  const ids = cat.gear.map((g) => g.id).filter((id) => !vocab.has(id));
  const hits = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) {
        const src = fs.readFileSync(p, "utf8");
        for (const id of ids) if (src.includes(`"${id}"`) || src.includes(`'${id}'`)) hits.push(`${p}: "${id}"`);
      }
    }
  };
  walk("src");
  assert.deepEqual(hits, []);
});

test("an install's setup.json can carry its own ranges for a gear item (used instead of the library's)", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "own-ranges-"));
  const own = { step: 1, methods: { pourover: { low: 10, high: 20 } } };
  fs.writeFileSync(path.join(dir, "setup.json"), JSON.stringify({ gear: ["ode-gen2", "hario-v60-02"], recipes: [], grindRanges: { "ode-gen2": own } }));
  const db = openDb(path.join(tmp, "own-ranges.db"));
  runSeed(db, dir);
  assert.deepEqual(JSON.parse(db.prepare("SELECT grindRanges FROM gear_items WHERE id='ode-gen2'").get().grindRanges), own);
  assert.equal(db.prepare("SELECT catalogId FROM gear_items WHERE id='ode-gen2'").get().catalogId, "ode-gen2", "still linked to the library");
  db.close();
});
