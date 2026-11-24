// First-run setup API: an empty install (no seed-data) onboards a stranger with their own gear.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-setup-"));
const emptySeed = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));
process.env.DATA_DIR = tmp;
process.env.SEED_DIR = emptySeed; // a public install ships no personal seed data

const { createApp } = await import("../dist/server/app.js");
const { openDb } = await import("../dist/server/db.js");

async function start(file) {
  const { app } = createApp(openDb(path.join(tmp, file)));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { server, call };
}

test("fresh install: empty, not onboarded, default settings", async () => {
  const { server, call } = await start("fresh.db");
  const s = (await call("GET", "/api/setup")).body;
  assert.equal(s.onboarded, false);
  assert.equal(s.empty, true);
  assert.deepEqual(
    { tempUnit: s.settings.tempUnit, waterUnit: s.settings.waterUnit, defaultRatio: s.settings.defaultRatio, discoverEnabled: s.settings.discoverEnabled, avoidRules: s.settings.avoidRules },
    { tempUnit: "C", waterUnit: "g", defaultRatio: 16, discoverEnabled: true, avoidRules: [] },
  );
  assert.equal((await call("PUT", "/api/settings", { tempUnit: "F", defaultRatio: 15 })).body.tempUnit, "F");
  assert.equal((await call("PUT", "/api/settings", { tempUnit: "K" })).status, 400);
  assert.equal((await call("GET", "/api/setup")).body.settings.defaultRatio, 15);
  // Dose → grind adjustment is a setting (on, 20% per doubling, drip methods by default).
  assert.deepEqual(s.settings.doseNudge, { enabled: true, percent: 20, methods: ["rapid", "pourover", "batch"] });
  const dn = { enabled: false, percent: 35, methods: ["pourover", "immersion"] };
  assert.deepEqual((await call("PUT", "/api/settings", { doseNudge: dn })).body.doseNudge, dn);
  assert.equal((await call("PUT", "/api/settings", { doseNudge: { ...dn, percent: 150 } })).status, 400);
  assert.equal((await call("PUT", "/api/settings", { doseNudge: { ...dn, methods: ["siphon"] } })).status, 400);
  server.closeAllConnections(); server.close();
});

test("V60 + a custom Comandante (calibrated pour-over range) → Hoffmann in Comandante clicks", async () => {
  const { server, call } = await start("stranger.db");
  assert.equal((await call("POST", "/api/gear/from-catalog", { catalogId: "hario-v60-02" })).status, 200);
  const c40 = (await call("POST", "/api/gear", {
    name: "Comandante C40", type: "grinder", category: "hand-grinder", units: "clicks",
    grindRanges: { step: 1, methods: { pourover: { low: 22, high: 28 } } },
  })).body;
  assert.equal(c40.category, "hand-grinder");
  const tpls = (await call("GET", "/api/setup/templates")).body;
  const hoff = tpls.find((t) => t.id === "hoffmann-v60");
  assert.ok(hoff, "Hoffmann offered for a V60");
  assert.equal(hoff.grinderName, "Comandante C40");
  assert.equal(hoff.grindSetting, 24); // position 0.3 inside 22–28 → 23.8 → 24
  assert.equal(tpls.filter((t) => t.name === "Show Horse" || t.name.startsWith("Show Horse")).length, 1, "one Show Horse per brewer");
  assert.ok(!tpls.some((t) => /aeropress|french/i.test(t.id)), "only recipes this gear can brew");
  const made = (await call("POST", "/api/recipes/from-templates", { ids: ["hoffmann-v60", "kasuya-4-6"] })).body;
  assert.equal(made.created.length, 2);
  assert.equal(made.created[0].grindSetting, 24);
  assert.equal((await call("POST", "/api/recipes/from-templates", { ids: ["hoffmann-v60"] })).body.skipped, 1, "no duplicates");
  assert.equal((await call("GET", "/api/setup/templates")).body.find((t) => t.id === "hoffmann-v60").alreadyAdded, true);
  assert.equal((await call("POST", "/api/recipes/from-templates", { ids: ["aeropress-default"] })).status, 400);
  assert.equal((await call("POST", "/api/setup/demo")).status, 409, "demo only into an empty install");
  await call("POST", "/api/setup/complete");
  assert.equal((await call("GET", "/api/setup")).body.onboarded, true);
  server.closeAllConnections(); server.close();
});

test("demo data loads into an empty install and is fictional", async () => {
  const { server, call } = await start("demo.db");
  const r = await call("POST", "/api/setup/demo");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const gear = (await call("GET", "/api/gear")).body;
  assert.ok(gear.length >= 4 && gear.every((g) => g.catalogId));
  const bags = (await call("GET", "/api/inventory")).body;
  assert.ok(bags.every((b) => /Example Roasters|Sample Coffee Co\./.test(b.roaster)));
  server.closeAllConnections(); server.close();
});

test("restore an export into an empty install; refused when data exists", async () => {
  const a = await start("src.db");
  await a.call("POST", "/api/setup/demo");
  const exported = await (await fetch(a.server.address() && `http://127.0.0.1:${a.server.address().port}/api/export`)).json();
  assert.equal((await a.call("POST", "/api/setup/restore", exported)).status, 409);
  a.server.closeAllConnections(); a.server.close();
  const b = await start("dst.db");
  assert.equal((await b.call("POST", "/api/setup/restore", { hello: 1 })).status, 400);
  const r = await b.call("POST", "/api/setup/restore", exported);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await b.call("GET", "/api/recipes")).body.length, exported.recipes.length);
  assert.equal((await b.call("GET", "/api/setup")).body.onboarded, true);
  b.server.closeAllConnections(); b.server.close();
});

test("an existing install with data is never shown first-run setup", async () => {
  const db = openDb(path.join(tmp, "old.db"));
  const t = new Date().toISOString();
  db.prepare("INSERT INTO gear_items (id, name, type, builtin, createdAt, updatedAt) VALUES ('x','X','other',0,?,?)").run(t, t);
  db.prepare("INSERT INTO meta (key, value) VALUES ('seededAt', ?)").run(t);
  db.close();
  const { server, call } = await start("old.db");
  assert.equal((await call("GET", "/api/setup")).body.onboarded, true);
  server.closeAllConnections(); server.close();
});

test("grind settings are numbers: older text is converted at startup; the API takes and returns numbers", async () => {
  const file = path.join(tmp, "oldgrind.db");
  const db = openDb(file);
  const t = new Date().toISOString();
  db.prepare("INSERT INTO gear_items (id, name, type, units, grindRanges, createdAt, updatedAt) VALUES (?, ?, 'grinder', ?, ?, ?, ?)")
    .run("acme-thirds", "Acme Thirds", "", JSON.stringify({ step: 1 / 3, notation: "thirds", methods: { pourover: { low: 4, high: 6 } } }), t, t);
  db.prepare("INSERT INTO gear_items (id, name, type, units, grindRanges, createdAt, updatedAt) VALUES (?, ?, 'grinder', 'clicks', ?, ?, ?)")
    .run("acme-hand", "Acme Hand 2", JSON.stringify({ step: 1, methods: { pourover: { low: 60, high: 80 } } }), t, t);
  const ins = db.prepare("INSERT INTO brews (recipeName, grinderId, grindSetting, doseG, waterG, brewedAt) VALUES ('Old', ?, ?, 20, 320, ?)");
  ins.run("acme-hand", "Acme Hand 2: 72 clicks (dial 7.2)", t);
  ins.run("acme-thirds", "setting 5.1", t);
  ins.run(null, "4.5-5 rotations", t);
  ins.run(null, "fine-ish", t);
  db.close();

  const { server, call } = await start("oldgrind.db");
  const brews = (await call("GET", "/api/brews")).body;
  assert.deepEqual(brews.map((b) => b.grindSetting).sort(), [4.75, 5.1, 72, null].sort());
  const r = await call("POST", "/api/brews", { recipeName: "New", doseG: 20, waterG: 320, grindSetting: 88.5 });
  assert.equal(r.status, 200); assert.equal(r.body.grindSetting, 88.5);
  const legacy = await call("POST", "/api/brews", { recipeName: "Old client", doseG: 20, waterG: 320, grindSetting: "70 clicks" });
  assert.equal(legacy.body.grindSetting, 70);
  const bad = await call("POST", "/api/brews", { recipeName: "Bad", doseG: 20, waterG: 320, grindSetting: "medium" });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Grind setting must be a number/);
  server.closeAllConnections(); server.close();
});

test("every library entry can be rebuilt as custom gear with the same fields (nothing is library-only)", async () => {
  const { server, call } = await start("replicate.db");
  try {
    const { loadCatalog } = await import("../dist/server/catalog.js");
    const FIELDS = ["name", "brand", "type", "category", "details", "units", "burrs", "variants", "defaultMethod", "grindRanges", "rangeInfo"];
    const norm = (v) => Array.isArray(v) ? (v.length ? v.map(norm) : undefined)
      : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]).filter(([, x]) => x !== undefined))
      : v === null || v === "" ? undefined : v;
    const entries = loadCatalog().gear;
    assert.ok(entries.length > 40);
    for (const e of entries) {
      const lib = (await call("POST", "/api/gear/from-catalog", { catalogId: e.id })).body;
      // A custom item made from the same JSON the library file holds (minus id/version).
      const { id, version, ...fields } = e;
      const made = await call("POST", "/api/gear", fields);
      assert.ok(made.status < 300 && made.body.id, `${e.id}: ${JSON.stringify(made.body)}`);
      const mine = (await call("GET", "/api/gear")).body.find((g) => g.id === made.body.id);
      for (const k of FIELDS) assert.deepEqual(norm(mine[k]), norm(lib[k]), `${e.id}.${k}`);
      assert.equal(mine.catalogId ?? null, null);
    }
  } finally {
    server.close();
  }
});

test("can-do per method: unticked methods drop their range; the old espresso flag migrates", async () => {
  const { server, call } = await start("cando.db");
  try {
    const made = (await call("POST", "/api/gear", { name: "Filter Mill", type: "grinder", category: "hand-grinder", units: "clicks",
      grindRanges: { methods: { espresso: { low: 1, high: 2 }, pourover: { low: 20, high: 30 } }, unsupported: ["espresso", "turkish"] } })).body;
    const g = (await call("GET", "/api/gear")).body.find((x) => x.id === made.id);
    assert.deepEqual(g.grindRanges.methods, { pourover: { low: 20, high: 30 } });
    assert.deepEqual(g.grindRanges.unsupported, ["turkish", "espresso"]);
    assert.equal("espressoCapable" in g, false);
    // An older client's "not espresso-capable" means the same thing.
    const old = (await call("POST", "/api/gear", { name: "Old Client Mill", type: "grinder", espressoCapable: false,
      grindRanges: { methods: { pourover: { low: 20, high: 30 } } } })).body;
    assert.deepEqual((await call("GET", "/api/gear")).body.find((x) => x.id === old.id).grindRanges.unsupported, ["espresso"]);
  } finally {
    server.close();
  }
  const { openDb } = await import("../dist/server/db.js");
  const { migrateEspressoCapable } = await import("../dist/server/seed.js");
  const db = openDb(path.join(tmp, "cando-migrate.db"));
  const t = new Date().toISOString();
  const ins = db.prepare("INSERT INTO gear_items (id, name, type, espressoCapable, grindRanges, createdAt, updatedAt) VALUES (?, ?, 'grinder', ?, ?, ?, ?)");
  ins.run("a", "A", 0, JSON.stringify({ methods: { pourover: { low: 1, high: 2 } } }), t, t);
  ins.run("b", "B", 0, null, t, t);
  ins.run("c", "C", 1, JSON.stringify({ methods: { espresso: { low: 1, high: 2 } } }), t, t);
  ins.run("d", "D", 0, JSON.stringify({ methods: { espresso: { low: 1, high: 2 } } }), t, t); // has a range: keep it usable
  assert.deepEqual(migrateEspressoCapable(db).sort(), ["a", "b"]);
  const gr = (id) => JSON.parse(db.prepare("SELECT grindRanges FROM gear_items WHERE id=?").get(id).grindRanges ?? "null");
  assert.deepEqual(gr("a").unsupported, ["espresso"]);
  assert.deepEqual(gr("b"), { methods: {}, unsupported: ["espresso"] });
  assert.equal(gr("c").unsupported, undefined);
  assert.equal(gr("d").unsupported, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gear_items WHERE espressoCapable IS NOT NULL").get().n, 0);
  assert.deepEqual(migrateEspressoCapable(db), []); // runs once
});
