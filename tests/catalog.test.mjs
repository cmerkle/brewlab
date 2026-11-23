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
  return { id: c.id, name: c.name, type: c.type, category: c.category, units: SPEC[id]?.units ?? c.units, grindRanges: SPEC[id]?.grindRanges ?? c.grindRanges ?? null };
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
  fs.writeFileSync(path.join(dir, "setup.json"), JSON.stringify({ gear: ["ode-gen2", "hario-v60-02"], recipes: [], grindRanges: { "ode-gen2": own }, units: { "ode-gen2": "notches" } }));
  const db = openDb(path.join(tmp, "own-ranges.db"));
  runSeed(db, dir);
  assert.deepEqual(JSON.parse(db.prepare("SELECT grindRanges FROM gear_items WHERE id='ode-gen2'").get().grindRanges), own);
  assert.equal(db.prepare("SELECT catalogId FROM gear_items WHERE id='ode-gen2'").get().catalogId, "ode-gen2", "still linked to the library");
  assert.equal(db.prepare("SELECT units FROM gear_items WHERE id='ode-gen2'").get().units, "notches");
  runSeed(db, dir); // a re-run keeps the install's units
  assert.equal(db.prepare("SELECT units FROM gear_items WHERE id='ode-gen2'").get().units, "notches");
  db.close();
});

/* ---------- Phase 5: contribution rules + "Suggest to the library" ---------- */

const { CatalogGear, libraryEntryFor } = await import("../dist/server/catalog.js");
const okGrinder = {
  id: "acme-hand", version: 1, name: "Acme Hand", brand: "Acme", type: "grinder", category: "hand-grinder", units: "clicks",
  grindRanges: { min: 0, max: 40, step: 1, methods: { pourover: { low: 20, high: 28 } } },
  rangeInfo: { confidence: "manufacturer", source: "https://example.com/acme-manual.pdf" },
};
const why = (g) => { const r = CatalogGear.safeParse(g); return r.success ? [] : r.error.issues.map((i) => i.message); };

test("library rules: a well-formed entry passes; each rule rejects what it should", () => {
  assert.deepEqual(why(okGrinder), []);
  const cases = [
    [{ rangeInfo: { ...okGrinder.rangeInfo, confidence: "drafted" } }, /cited source/],
    [{ rangeInfo: { confidence: "community", source: null } }, /cite a source URL/],
    [{ rangeInfo: { confidence: "community", source: "http://example.com/x" } }, /https:\/\//],
    [{ rangeInfo: undefined }, /need a rangeInfo/],
    [{ grindRanges: { ...okGrinder.grindRanges, methods: { pourover: { low: 30, high: 20 } } } }, /low must be ≤ high/],
    [{ grindRanges: { ...okGrinder.grindRanges, methods: { pourover: { low: 20, high: 50 } } } }, /above the grinder's max 40/],
    [{ grindRanges: { ...okGrinder.grindRanges, methods: {} } }, /no methods/],
    [{ category: "cone-dripper" }, /needs a grinder category/],
    [{ type: "brewer" }, /for grinders, but type is "brewer"/],
  ];
  for (const [patch, re] of cases) {
    const msgs = why({ ...okGrinder, ...patch });
    assert.ok(msgs.some((m) => re.test(m)), `${JSON.stringify(patch)} → ${msgs.join(" | ") || "(accepted)"}`);
  }
  assert.ok(why({ id: "x-dripper", version: 1, name: "X", brand: null, type: "brewer", category: "cone-dripper", grindRanges: okGrinder.grindRanges, rangeInfo: okGrinder.rangeInfo }).some((m) => /only grinders/.test(m)));
});

const row = (o) => ({ id: "x", name: "X", type: "grinder", brand: null, category: "hand-grinder", details: null, units: "clicks", burrs: null, espressoCapable: null, variants: null, defaultMethod: null, grindRanges: null, catalogId: null, ...o });

test("suggest: custom grinder → a new entry that passes the library rules once a source is given", () => {
  const g = row({ id: "my-comandante", name: "Comandante C41", brand: "Comandante", grindRanges: { step: 1, methods: { pourover: { low: 22, high: 28 } } } });
  const noSource = libraryEntryFor(g, {});
  assert.equal(noSource.kind, "new");
  assert.equal(noSource.id, "comandante-c41");
  assert.ok(noSource.issues.some((i) => /confidence/.test(i)) && noSource.issues.some((i) => /source/.test(i)), noSource.issues.join(" | "));
  const ok = libraryEntryFor(g, { confidence: "community", source: "https://example.com/chart", note: "Chart says V60 22–28." });
  assert.deepEqual(ok.issues, []);
  const entry = JSON.parse(ok.json);
  assert.deepEqual(Object.keys(entry).slice(0, 6), ["id", "version", "name", "brand", "type", "category"]);
  assert.equal(entry.rangeInfo.note, "Chart says V60 22–28.");
  assert.ok(ok.githubUrl.startsWith("https://github.com/") && ok.githubUrl.includes("filename=comandante-c41.json"));
  assert.equal(JSON.parse(decodeURIComponent(new URL(ok.githubUrl).searchParams.get("value"))).id, "comandante-c41");
});

test("suggest: custom gear without ranges needs no source; missing Kind and name clashes are explained", () => {
  assert.deepEqual(libraryEntryFor(row({ name: "Bloom Dripper", type: "brewer", category: "cone-dripper", units: null }), {}).issues, []);
  assert.ok(libraryEntryFor(row({ name: "Mystery", category: null }), {}).issues.some((i) => /Kind/.test(i)));
  const clash = libraryEntryFor(row({ name: "Comandante C40", brand: "Comandante" }), {});
  assert.ok(clash.issues.some((i) => /already has "comandante-c40"/.test(i)), clash.issues.join(" | "));
});

test("suggest: library gear → an update of that entry with the user's ranges, version bumped", () => {
  const lib = cat.gear.find((x) => x.id === "comandante-c40");
  const g = row({ id: "comandante-c40", name: "My C40", catalogId: "comandante-c40", grindRanges: { step: 1, methods: { pourover: { low: 22, high: 30 } } } });
  const up = libraryEntryFor(g, { confidence: "community", source: "https://example.com/c40" });
  assert.equal(up.kind, "update");
  assert.deepEqual(up.issues, []);
  const e = JSON.parse(up.json);
  assert.equal(e.name, lib.name, "keeps the library's identity, not the user's nickname");
  assert.equal(e.version, lib.version + 1);
  assert.deepEqual(e.grindRanges.methods.pourover, { low: 22, high: 30 });
  assert.ok(up.githubUrl.endsWith("/edit/main/catalog/gear/comandante-c40.json"));
  assert.ok(libraryEntryFor({ ...g, grindRanges: null }, {}).issues.some((i) => /Nothing to suggest/.test(i)));
});

test("older installs: linking uses the install's setup.json ranges/units over the library's", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "old-own-"));
  const own = { step: 1, methods: { pourover: { low: 80, high: 100 } } };
  fs.writeFileSync(path.join(dir, "setup.json"), JSON.stringify({ grindRanges: { k6: own }, units: { k6: "clicks" } }));
  const db = openDb(path.join(tmp, "old-own.db"));
  const t = new Date().toISOString();
  for (const id of ["k6", "zp6"]) db.prepare("INSERT INTO gear_items (id, name, type, units, builtin, grindRanges, createdAt, updatedAt) VALUES (?, ?, 'grinder', 'x', 1, NULL, ?, ?)").run(id, id, t, t);
  assert.equal(linkGearToCatalog(db, dir), 2);
  const k6 = db.prepare("SELECT * FROM gear_items WHERE id='k6'").get();
  assert.deepEqual(JSON.parse(k6.grindRanges), own, "the install's ranges, not the library's");
  assert.equal(k6.units, "clicks");
  const zp6 = db.prepare("SELECT * FROM gear_items WHERE id='zp6'").get();
  assert.deepEqual(JSON.parse(zp6.grindRanges), cat.gear.find((g) => g.id === "zp6").grindRanges ?? null, "no override → library");
  assert.equal(zp6.units, "x", "units untouched without an override");
  db.close();
});
