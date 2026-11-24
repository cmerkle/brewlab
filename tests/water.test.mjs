// Water recipes: hardness math, the water library, and the API (links from recipes and brews).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-water-"));
process.env.DATA_DIR = tmp;
process.env.SEED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));

const { hardness, convertAmount, toLitres } = await import("../dist/shared/water.js");
const { loadWaterCatalog } = await import("../dist/server/catalog.js");
const { createApp } = await import("../dist/server/app.js");
const { openDb } = await import("../dist/server/db.js");
const { exportAll } = await import("../dist/server/backup.js");

const cat = loadWaterCatalog(undefined, true);
const line = (additiveId, amount, unit) => ({ additiveId, name: additiveId, amount, unit });

test("hardness: salts by molar mass, scaled by amount and volume; g ↔ mg", () => {
  const epsom1L = hardness({ baseId: "distilled", volume: 1, volumeUnit: "L", additives: [line("epsom-salt", 1, "g")] }, cat);
  assert.deepEqual([epsom1L.gh, epsom1L.kh, epsom1L.unknown], [406.1, 0, []]);
  // 100 mg in 500 ml = 0.2 g/L
  const h = hardness({ baseId: "distilled", volume: 500, volumeUnit: "ml", additives: [line("epsom-salt", 100, "mg"), line("baking-soda", 0.084, "g")] }, cat);
  assert.equal(h.gh, 81.2);
  assert.equal(h.kh, 100.1);
  assert.equal(Math.round(toLitres(1, "gal") * 1000) / 1000, 3.785);
  assert.equal(convertAmount(1, "drops", "g"), null);
});

test("hardness: unknowns stay unknown — never guessed", () => {
  // A base without numbers until you enter them
  let h = hardness({ baseId: "tap", volume: 1, volumeUnit: "L", additives: [line("epsom-salt", 0.1, "g")] }, cat);
  assert.equal(h.gh, null);
  assert.match(h.unknown[0], /Tap: enter its hardness/);
  h = hardness({ baseId: "tap", baseGh: 50, baseKh: 30, volume: 1, volumeUnit: "L", additives: [line("epsom-salt", 0.1, "g")] }, cat);
  assert.deepEqual([h.gh, h.kh], [90.6, 30]);
  // TWW publishes alkalinity, not hardness
  h = hardness({ baseId: "distilled", volume: 1, volumeUnit: "gal", additives: [line("tww-classic-light-roast", 1, "packets")] }, cat);
  assert.deepEqual([h.gh, h.kh], [null, 40]);
  assert.match(h.unknown.join(), /hardness not published/);
  // A unit the strength can't be converted to
  h = hardness({ baseId: "distilled", volume: 1, volumeUnit: "L", additives: [line("epsom-salt", 2, "tsp")] }, cat);
  assert.equal(h.gh, null);
  // Your own additive: what it adds, if you say
  h = hardness({ baseId: "distilled", volume: 1, volumeUnit: "L", additives: [{ name: "Mystery minerals", amount: 3, unit: "drops", gh: 12, kh: 4 }] }, cat);
  assert.deepEqual([h.gh, h.kh], [12, 4]);
  h = hardness({ baseId: "distilled", volume: 1, volumeUnit: "L", additives: [{ name: "Mystery minerals", amount: 3, unit: "drops" }] }, cat);
  assert.equal(h.gh, null);
});

test("water library: loads clean; every recipe cites a source; published GH/KH match the additives", () => {
  assert.deepEqual(cat.errors, []);
  assert.ok(cat.recipes.length >= 15);
  for (const t of cat.recipes) {
    assert.match(t.source, /^https:\/\//, t.id);
    const h = hardness({ baseId: t.base, volume: t.volume, volumeUnit: t.volumeUnit, additives: t.additives.map((l) => line(l.additive, l.amount, l.unit)) }, cat);
    for (const k of ["gh", "kh"]) if (t.stated?.[k] != null && h[k] != null) assert.ok(Math.abs(h[k] - t.stated[k]) <= Math.max(2, t.stated[k] * 0.1), `${t.id} ${k}: ${h[k]} vs ${t.stated[k]}`);
  }
  for (const a of cat.additives) if (a.basis === "published") assert.match(a.source, /^https:\/\//, a.id);
});

test("water API: library copy, your own, links from recipes and brews, rename, delete keeps the name, export", async () => {
  const db = openDb(path.join(tmp, "brewlab.db"));
  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    let r = await call("GET", "/api/water/catalog");
    assert.ok(r.body.recipes.some((t) => t.id === "lotus-rao-perger" && t.hardness.gh === 90 && !t.owned));

    r = await call("POST", "/api/water/from-catalog", { catalogId: "lotus-rao-perger" });
    assert.equal(r.status, 200);
    const lib = r.body;
    assert.equal(lib.catalogId, "lotus-rao-perger");
    assert.equal(lib.additives.length, 4);
    assert.deepEqual([lib.hardness.gh, lib.hardness.kh], [90, 42.8]);
    assert.equal((await call("POST", "/api/water/from-catalog", { catalogId: "nope" })).status, 404);
    assert.ok((await call("GET", "/api/water/catalog")).body.recipes.find((t) => t.id === "lotus-rao-perger").owned);
    // A second copy gets a numbered name
    assert.equal((await call("POST", "/api/water/from-catalog", { catalogId: "lotus-rao-perger" })).body.name, "Rao/Perger (Lotus drops) (2)");

    // Your own: a library salt plus a custom additive
    const mine = { name: "My soft water", baseId: "distilled", volume: 1, volumeUnit: "gal", notes: "Test",
      additives: [{ additiveId: "epsom-salt", name: "x", amount: 0.5, unit: "g" }, { name: "Tap splash", amount: 50, unit: "ml", gh: 5, kh: 3 }] };
    r = await call("POST", "/api/water", mine);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const own = r.body;
    assert.equal(own.additives[0].name, "Epsom salt (magnesium sulfate)"); // library name, not what was sent
    assert.equal(own.hardness.gh, Math.round((406.1 * 0.5 / 3.785411784 + 5) * 10) / 10);

    // Refusals with plain messages
    for (const [body, msg] of [
      [{ ...mine, additives: [{ additiveId: "unobtainium", name: "U", amount: 1, unit: "g" }] }, /Unknown additive/],
      [{ ...mine, volume: 0 }, /Volume must be more than 0/],
      [{ ...mine, volumeUnit: "pints" }, /Volume units are/],
      [{ ...mine, additives: [{ name: "X", amount: -1, unit: "g" }] }, /more than 0/],
      [{ ...mine, additives: [{ name: "X", amount: 1, unit: "scoops" }] }, /Additive units are/],
      [{ ...mine, name: " " }, /Name is required/],
    ]) {
      const x = await call("POST", "/api/water", body);
      assert.equal(x.status, 400);
      assert.match(x.body.error, msg);
    }

    // A recipe names its water; a brew records the one it used
    r = await call("POST", "/api/recipes", { name: "Water test V60", doseG: 15, waterG: 250, steps: [], waterId: own.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const recipe = r.body;
    assert.equal(recipe.waterName, "My soft water");
    r = await call("POST", "/api/brews", { recipeId: recipe.id, doseG: 15, waterG: 250, waterId: lib.id, rating: 4 });
    const brew = r.body;
    assert.equal(brew.waterName, "Rao/Perger (Lotus drops)");
    await call("POST", "/api/brews", { doseG: 15, waterG: 250, waterId: lib.id, rating: 5 });
    assert.equal((await call("POST", "/api/brews", { doseG: 15, waterG: 250, waterId: 9999 })).status, 400);
    // Same recipe with another water isn't "identical"
    assert.equal((await call("POST", "/api/recipes", { name: "Water test V60", doseG: 15, waterG: 250, steps: [], waterId: lib.id })).status, 200);

    // Usage: how many brews, and how they were rated
    const list = (await call("GET", "/api/water")).body;
    const u = list.find((w) => w.id === lib.id).usage;
    assert.deepEqual([u.brews, u.rated, u.avgRating], [2, 2, 4.5]);
    assert.equal(list.find((w) => w.id === own.id).usage.recipes, 1);

    // Rename: linked recipes and brews follow
    r = await call("PUT", `/api/water/${own.id}`, { ...mine, name: "Soft water v2" });
    assert.equal(r.status, 200);
    assert.equal((await call("GET", `/api/recipes/${recipe.id}`)).body.waterName, "Soft water v2");

    // Export carries water recipes
    assert.equal(exportAll(db).water_recipes.length, 3);

    // Delete: the recipe and brew keep the name, lose the link
    assert.equal((await call("DELETE", `/api/water/${lib.id}`)).status, 200);
    const b2 = (await call("GET", "/api/brews")).body.find((x) => x.id === brew.id);
    assert.deepEqual([b2.waterId, b2.waterName], [null, "Rao/Perger (Lotus drops)"]);
    assert.equal((await call("DELETE", `/api/water/${lib.id}`)).status, 404);
  } finally {
    server.close();
    db.close();
  }
});

test("concentrates: your own stock solution, added by the gram; Barista Hustle's concentrates from the library", async () => {
  const db = openDb(path.join(tmp, "conc.db"));
  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    // Barista Hustle: grams of buffer / hardness concentrate per litre ≈ ppm
    let r = await call("POST", "/api/water/from-catalog", { catalogId: "bh-budapest" });
    assert.deepEqual([r.body.hardness.gh, r.body.hardness.kh], [50.8, 40.1]);

    // Your own stock: 6.8 g calcium chloride dihydrate in 1 L
    const stock = (await call("POST", "/api/water", { name: "CaCl2 stock", concentrate: true, baseId: "distilled", volume: 1, volumeUnit: "L",
      additives: [{ additiveId: "calcium-chloride-dihydrate", name: "x", amount: 6.8, unit: "g" }] })).body;
    assert.equal(stock.concentrate, true);
    assert.equal(stock.hardness.gh, 4629.4);
    // 10 g of it in 1 L of finished water = 1% stock
    const mixBody = { name: "Calcium water", baseId: "distilled", volume: 1, volumeUnit: "L",
      additives: [{ concentrateId: stock.id, name: "whatever", amount: 10, unit: "g" }, { additiveId: "baking-soda", name: "x", amount: 0.05, unit: "g" }] };
    r = await call("POST", "/api/water", mixBody);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const mixed = r.body;
    assert.equal(mixed.additives[0].name, "CaCl2 stock");
    assert.deepEqual([mixed.hardness.gh, mixed.hardness.kh], [46.3, 29.8]);
    // Renaming the stock shows on the water that uses it
    await call("PUT", `/api/water/${stock.id}`, { name: "Calcium stock", concentrate: true, baseId: "distilled", volume: 1, volumeUnit: "L",
      additives: [{ additiveId: "calcium-chloride-dihydrate", name: "x", amount: 6.8, unit: "g" }] });
    assert.equal((await call("GET", "/api/water")).body.find((w) => w.id === mixed.id).additives[0].name, "Calcium stock");

    // Refusals
    const refuse = async (method, url, body, status, msg) => {
      const x = await call(method, url, body);
      assert.equal(x.status, status, `${url}: ${JSON.stringify(x.body)}`);
      assert.match(x.body.error, msg);
    };
    await refuse("POST", "/api/water", { ...mixBody, concentrate: true }, 400, /can't contain another concentrate/);
    await refuse("POST", "/api/water", { ...mixBody, additives: [{ concentrateId: mixed.id, name: "m", amount: 1, unit: "g" }] }, 400, /isn't one of your concentrates/);
    await refuse("POST", "/api/water", { ...mixBody, additives: [{ concentrateId: stock.id, name: "m", amount: 1, unit: "drops" }] }, 400, /in g, mg or ml/);
    await refuse("DELETE", `/api/water/${stock.id}`, null, 409, /concentrate in Calcium water/);
    await refuse("PUT", `/api/water/${stock.id}`, { name: "Calcium stock", baseId: "distilled", volume: 1, volumeUnit: "L", additives: [] }, 409, /still a concentrate in Calcium water/);
    await refuse("POST", "/api/brews", { doseG: 15, waterG: 250, waterId: stock.id }, 400, /is a concentrate/);
    await call("POST", "/api/brews", { doseG: 15, waterG: 250, waterId: mixed.id });
    await refuse("PUT", `/api/water/${mixed.id}`, { ...mixBody, concentrate: true, additives: [] }, 409, /can't become a concentrate/);

    // Take it out of the water, then it can go
    await call("PUT", `/api/water/${mixed.id}`, { ...mixBody, additives: mixBody.additives.slice(1) });
    assert.equal((await call("DELETE", `/api/water/${stock.id}`)).status, 200);
  } finally {
    server.close();
    db.close();
  }
});

test("demo data and restore bring water recipes along", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "demo-"));
  const db = openDb(path.join(dir, "brewlab.db"));
  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await call("POST", "/api/setup/demo")).status, 200);
    const water = (await call("GET", "/api/water")).body;
    assert.equal(water.length, 2);
    const brews = (await call("GET", "/api/brews")).body;
    assert.ok(brews.every((b) => b.waterId != null && b.waterName));
    const ex = exportAll(db);
    // Restore into another empty install
    const db2 = openDb(path.join(dir, "restored.db"));
    const app2 = createApp(db2).app;
    const s2 = await new Promise((r) => { const s = app2.listen(0, "127.0.0.1", () => r(s)); });
    const res = await fetch(`http://127.0.0.1:${s2.address().port}/api/setup/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ex) });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(db2.prepare("SELECT COUNT(*) n FROM water_recipes").get().n, 2);
    assert.equal(db2.prepare("SELECT COUNT(*) n FROM brews WHERE waterId IS NOT NULL").get().n, brews.length);
    s2.close();
    db2.close();
  } finally {
    server.close();
    db.close();
  }
});
