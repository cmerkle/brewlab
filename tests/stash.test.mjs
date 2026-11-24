// Stash: editing what's left of a bag (coffee used without logging a brew).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-stash-"));
process.env.DATA_DIR = tmp;
process.env.SEED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));
const { createApp } = await import("../dist/server/app.js");
const { openDb } = await import("../dist/server/db.js");

test("what's left: set by hand, then logged brews keep counting down; the bag size can change", async () => {
  const db = openDb(path.join(tmp, "brewlab.db"));
  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    const bag = (await call("POST", "/api/inventory", { name: "Left Test", amountG: 340 })).body;
    await call("POST", "/api/brews", { doseG: 20, waterG: 320, inventoryId: bag.id });
    const get = async () => (await call("GET", "/api/inventory")).body.find((b) => b.id === bag.id);
    assert.equal((await get()).remainingG, 320);

    // 70 g went into a grinder purge, a gift, a cold brew … — nothing logged
    let r = await call("POST", `/api/inventory/${bag.id}/remaining`, { remainingG: 250 });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.remainingG, r.body.unloggedG, r.body.usedG], [250, 70, 20]);
    await call("POST", "/api/brews", { doseG: 15, waterG: 250, inventoryId: bag.id });
    assert.equal((await get()).remainingG, 235);
    // A later bag-size correction keeps the unlogged grams
    await call("PUT", `/api/inventory/${bag.id}`, { amountG: 300 });
    assert.equal((await get()).remainingG, 195);
    // More left than the brews imply (a brew logged against the wrong bag): allowed up to the size
    r = await call("POST", `/api/inventory/${bag.id}/remaining`, { remainingG: 280 });
    assert.deepEqual([r.body.remainingG, r.body.unloggedG], [280, -15]);

    for (const v of [-1, 301, "100", null]) assert.equal((await call("POST", `/api/inventory/${bag.id}/remaining`, { remainingG: v })).status, 400, String(v));
    const noSize = (await call("POST", "/api/inventory", { name: "No size" })).body;
    r = await call("POST", `/api/inventory/${noSize.id}/remaining`, { remainingG: 10 });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /bag size first/);
    assert.equal((await call("POST", "/api/inventory/9999/remaining", { remainingG: 1 })).status, 404);
  } finally {
    server.close();
    db.close();
  }
});

const { sortBags, bagMatches, BAG_SORTS } = await import("../dist/shared/stash.js");
const B = (id, o) => ({ id, name: `Bag ${id}`, roaster: null, origin: null, processMethod: null, roastLevel: null, notes: null, roastDate: null,
  purchaseDate: null, openedDate: null, finishedDate: null, rating: null, price: null, remainingG: null, status: "unopened", ...o });
const bags = [
  B(1, { name: "Élan", roaster: "Zeta", origin: "Kenya", roastDate: "2026-11-01", rating: 4, price: 22, status: "open", openedDate: "2026-11-10" }),
  B(2, { name: "apex", roaster: "alpha", origin: "Ethiopia", roastDate: "2026-10-15", rating: 5, price: 18 }),
  B(3, { name: "Mango", roaster: "Beta", origin: null, roastDate: null, rating: null, price: 30, status: "open", openedDate: "2026-11-12" }),
];
const ids = (list) => list.map((b) => b.id).join(",");

test("stash sort: every field, both directions; missing values always last; accents and case folded", () => {
  assert.equal(ids(sortBags(bags, "status", "asc")), "3,1,2"); // open (most recently opened first), then unopened
  assert.equal(ids(sortBags(bags, "name", "asc")), "2,1,3"); // apex, Élan, Mango
  assert.equal(ids(sortBags(bags, "name", "desc")), "3,1,2");
  assert.equal(ids(sortBags(bags, "roaster", "asc")), "2,3,1");
  assert.equal(ids(sortBags(bags, "origin", "asc")), "2,1,3"); // no origin → last
  assert.equal(ids(sortBags(bags, "origin", "desc")), "1,2,3"); // … in both directions
  assert.equal(ids(sortBags(bags, "roastDate", "desc")), "1,2,3");
  assert.equal(ids(sortBags(bags, "roastDate", "asc")), "2,1,3");
  assert.equal(ids(sortBags(bags, "rating", "desc")), "2,1,3");
  assert.equal(ids(sortBags(bags, "price", "asc")), "2,1,3");
  assert.equal(ids(sortBags(bags, "price", "desc")), "3,1,2");
  assert.equal(ids(sortBags(bags, "openedDate", "desc")), "3,1,2");
  for (const k of Object.keys(BAG_SORTS)) assert.equal(sortBags(bags, k, "asc").length, 3, k);
  assert.equal(ids(bags), "1,2,3"); // the input isn't reordered
});

test("stash search: name, roaster, origin, dates, month, rating, price; every word must match", () => {
  const find = (q) => ids(bags.filter((b) => bagMatches(b, q)));
  assert.equal(find(""), "1,2,3");
  assert.equal(find("elan"), "1"); // accent folded
  assert.equal(find("ALPHA"), "2");
  assert.equal(find("kenya"), "1");
  assert.equal(find("2026-10"), "2");
  assert.equal(find("october"), "2");
  assert.equal(find("5★"), "2");
  assert.equal(find("4 stars"), "1");
  assert.equal(find("$30"), "3");
  assert.equal(find("kenya zeta"), "1");
  assert.equal(find("kenya alpha"), "");
  assert.ok(bagMatches(bags[0], "nov 1", (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })));
});

const { roastLevelOf, nearestRoastLevel, restWindowFor, freshnessNote, splitTags } = await import("../dist/shared/stash.js");
const { loadVocab } = await import("../dist/server/catalog.js");
const vocab = loadVocab(undefined, true);

test("coffee words load; roast levels match their spellings; free text gets the nearest level", () => {
  assert.equal(vocab.error, null);
  const L = vocab.vocab.roastLevels;
  assert.deepEqual(L.map((l) => l.label), ["Ultra light", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"]);
  for (const [text, label] of [["light-medium", "Medium-light"], ["Medium Light Roast", "Medium-light"], ["ULTRALIGHT", "Ultra light"], ["full city", "Medium-dark"], ["French", "Dark"], ["medium", "Medium"]])
    assert.equal(roastLevelOf(text, L)?.label, label, text);
  assert.equal(roastLevelOf("espresso blend thing", L), null);
  assert.equal(nearestRoastLevel("very dark and oily", L).label, "Dark");
  assert.equal(nearestRoastLevel(null, L).label, "Medium");
  assert.ok(vocab.vocab.processes.includes("Washed") && vocab.vocab.origins.includes("Ethiopia"));
});

test("rest and peak window per roast level, with your own overrides", () => {
  const L = vocab.vocab.roastLevels;
  assert.deepEqual(({ ...restWindowFor("Light", L) }).rest, 10);
  assert.equal(restWindowFor("Light", L, { light: { rest: 12, peakEnd: 50 } }).rest, 12);
  assert.match(freshnessNote(5, "Light", L).text, /resting; usually best from about day 10 for a light roast/);
  assert.match(freshnessNote(5, "Dark", L).text, /in its peak window for a dark roast/);
  assert.match(freshnessNote(40, "Dark", L).text, /past the usual peak window for a dark roast \(day 21\)/);
  assert.match(freshnessNote(5, null, L).text, /in its peak window$/); // no roast level → Medium, no "for a … roast"
  assert.equal(freshnessNote(null, "Light", L), null);
  assert.deepEqual(splitTags("Strawberry, citrus · milk chocolate and honey; Jasmine."), ["strawberry", "citrus", "milk chocolate", "honey", "jasmine"]);
});

test("bags: tasting-note tags, roast level matched on save, old notes tidied into tags; settings check the windows", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "tags-"));
  const db = openDb(path.join(dir, "brewlab.db"));
  const { tidyBags } = await import("../dist/server/bags.js");
  // A bag from before tags: tasting notes inside the notes, a loosely written roast level
  db.prepare("INSERT INTO inventory_items (name, roastLevel, notes, source, status, createdAt, updatedAt) VALUES ('Old bag', 'light-medium', 'From the shop · Tasting notes: Peach, Jasmine, black tea', 'manual', 'unopened', 'x', 'x')").run();
  assert.deepEqual(tidyBags(db), { roast: 1, tags: 1 });
  const old = db.prepare("SELECT * FROM inventory_items WHERE name='Old bag'").get();
  assert.deepEqual([old.roastLevel, old.notes, JSON.parse(old.tastingNotes)], ["Medium-light", "From the shop", ["peach", "jasmine", "black tea"]]);
  assert.deepEqual(tidyBags(db), { roast: 0, tags: 0 }); // idempotent

  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    let r = await call("POST", "/api/inventory", { name: "Tag bag", roastLevel: "medium dark", origin: "My farm, Narnia", tastingNotes: ["Strawberry", "strawberry", " citrus "] });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.roastLevel, r.body.origin, r.body.tastingNotes], ["Medium-dark", "My farm, Narnia", ["strawberry", "citrus"]]);
    r = await call("PUT", `/api/inventory/${r.body.id}`, { rating: 5 }); // a partial update keeps the tags
    assert.deepEqual(r.body.tastingNotes, ["strawberry", "citrus"]);
    // Added from Discover: the pick's tasting notes become tags, not a notes line
    const { addToInventory } = await import("../dist/server/routes-brew.js");
    const added = addToInventory(db, { name: "Pick", roaster: "R", tastingNotes: "Mango, papaya and lime", roastLevel: "Light" }).item;
    assert.deepEqual([added.tastingNotes, added.notes], [["mango", "papaya", "lime"], null]);
    // Rest windows: the peak has to end after the rest
    assert.equal((await call("PUT", "/api/settings", { restWindows: { light: { rest: 20, peakEnd: 10 } } })).status, 400);
    assert.equal((await call("PUT", "/api/settings", { restWindows: { light: { rest: 12, peakEnd: 50 } } })).status, 200);
    assert.deepEqual((await call("GET", "/api/vocab")).body.roastLevels.length, 6);
  } finally {
    server.close();
    db.close();
  }
});

test("Discover: Preferred / Rather-avoid tags steer the prompt and the ranking; tags that are off don't; bag tags count as notes", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "prefs-"));
  const db = openDb(path.join(dir, "brewlab.db"));
  const { setSettings, getSettings } = await import("../dist/server/settings.js");
  const { tasteSummary, tasteProfileText, scoreCandidate, ratedCoffees } = await import("../dist/server/taste.js");
  const add = (p, sec, list, label) => ({ ...p, [sec]: { ...p[sec], [list]: [...p[sec][list], { id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label, on: true }] } });
  let p = getSettings(db).prefs;
  p = add(p, "roasters", "prefer", "Good Roasters");
  p = add(p, "roasters", "avoid", "Meh Coffee");
  p = add(p, "origins", "prefer", "Kenya");
  p = add(p, "origins", "avoid", "Sumatra");
  p = { ...p, notes: { ...p.notes, prefer: p.notes.prefer.map((t) => (t.label === "Berries" ? { ...t, on: true } : t)) } };
  setSettings(db, { prefs: p });
  const prompt = tasteProfileText(tasteSummary(db), getSettings(db));
  assert.match(prompt, /They prefer[^]*- Roasters: Good Roasters/);
  assert.match(prompt, /They prefer[^]*- Tasting notes: Berries/);
  assert.match(prompt, /rather avoid[^]*- Origins: Sumatra/);
  assert.doesNotMatch(prompt, /Citrus/, "tags that are off aren't mentioned");
  const prefs = getSettings(db).prefs;
  const s = tasteSummary(db);
  const c = (o) => ({ kind: "pick", name: "X", roaster: "Other", origin: "Colombia", ...o });
  const { tagHit } = await import("../dist/shared/prefs.js");
  assert.equal(tagHit({ label: "Peaberries" }, "Kenya Peaberry"), "Peaberry");
  assert.equal(tagHit({ label: "Blends" }, "House blend"), "Blend");
  assert.equal(tagHit({ label: "Glass" }, "glass jar"), "Glass");
  const good = scoreCandidate(c({ roaster: "good roasters" }), s, prefs);
  const meh = scoreCandidate(c({ roaster: "Meh Coffee" }), s, prefs);
  const kenya = scoreCandidate(c({ origin: "Kenya, Nyeri" }), s, prefs);
  const berry = scoreCandidate(c({ tastingNotes: "blueberry, cocoa" }), s, prefs);
  const plain = scoreCandidate(c({}), s, prefs);
  assert.ok(good.score > plain.score && kenya.score > plain.score && berry.score > plain.score && meh.score < plain.score);
  assert.match(good.reason, /preferred roasters: Good Roasters/);
  assert.match(berry.reason, /preferred tasting notes: Berries/);
  assert.match(meh.reason, /rather-avoid list \(roasters: Meh Coffee\)/);
  // A rated bag's tags reach the taste summary as its notes
  db.prepare("INSERT INTO inventory_items (name, rating, tastingNotes, source, status, createdAt, updatedAt) VALUES ('Berry bag', 5, '[\"strawberry\",\"raspberry\"]', 'manual', 'unopened', 'x', 'x')").run();
  assert.match(ratedCoffees(db).find((x) => x.name === "Berry bag").notes, /strawberry, raspberry/);
  db.close();
});
