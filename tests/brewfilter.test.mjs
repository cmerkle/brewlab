// Brew Log and Stash search and filters (the shared facet engine).
import { test } from "node:test";
import assert from "node:assert/strict";

const F = await import("../dist/shared/filters.js");
const B = await import("../dist/shared/brewfilter.js");
const S = await import("../dist/shared/stash.js");

const bags = new Map([
  [1, { id: 1, name: "Kirinyaga AA", roaster: "Harbor Light", origin: "Kenya", processMethod: "Washed", roastLevel: "Light", tastingNotes: ["blackcurrant"] }],
  [2, { id: 2, name: "Sitio Alto", roaster: "Paper Kite", origin: "Brazil", processMethod: "Natural", roastLevel: "Medium", tastingNotes: [] }],
]);
const brew = (o) => ({ brewedAt: "2026-11-20T08:00:00", recipeName: "V60", brewerName: "Hario V60 02", grinderName: "ZP6", grindSetting: 5, method: "pourover", coffee: null, waterName: null, rating: null, notes: null, doseG: 15, waterG: 250, inventoryId: null, ...o });
const items = B.withBags([
  brew({ inventoryId: 1, coffee: "Kirinyaga AA", rating: 5, waterName: "TWW Light" }),
  brew({ inventoryId: 1, coffee: "Kirinyaga AA", rating: 3.5, grinderName: "Ode Gen 2", brewedAt: "2026-11-10T08:00:00" }),
  brew({ inventoryId: 2, coffee: "Sitio Alto", recipeName: "Espresso", brewerName: "Barista Express", method: "espresso", doseG: 18, waterG: 36, rating: 3, notes: "Sour, grind finer" }),
  brew({ coffee: "Café de Olla", recipeName: "French press", brewerName: "Bodum", method: "immersion" }),
], bags);
const f = (picked, dates = {}) => ({ picked, dates });
const run = (flt, q = "") => B.filterBrews(items, flt, q).length;
const opts = (id, flt, q = "") => F.facetOptions(items, B.BREW_FACETS, B.BREW_DATES, id, flt, (x) => B.brewMatchesQuery(x, q));

test("brew facets come from the brew and its Stash bag; OR within a facet, AND across facets", () => {
  assert.equal(run(f({ roaster: ["Harbor Light"] })), 2);
  assert.equal(run(f({ roaster: ["harbor light", "Paper Kite"] })), 3, "any of the picked values, case-insensitive");
  assert.equal(run(f({ roaster: ["Harbor Light"], grinder: ["ZP6"] })), 1);
  assert.equal(run(f({ method: ["Espresso"] })), 1, "methods by their label");
  assert.equal(run(f({ rating: ["Not rated"] })), 1);
  assert.equal(run(f({ rating: ["3.5★"] })), 1, "half stars");
  assert.equal(run(f({ coffee: ["Café de Olla"] })), 1, "a coffee typed on the brew, without a bag");
  assert.equal(run(f({ roastLevel: ["Light"], process: ["Washed"], origin: ["Kenya"], water: ["TWW Light"] })), 1);
  assert.equal(run(f({ roaster: [] })), 4, "an empty pick is no filter");
});

test("brew dates are inclusive local days; the search needs every word somewhere", () => {
  assert.equal(run(f({}, { brewed: { from: "2026-11-15" } })), 3);
  assert.equal(run(f({}, { brewed: { to: "2026-11-10" } })), 1);
  assert.equal(run(f({}, { brewed: { from: "2026-11-10", to: "2026-11-10" } })), 1);
  assert.equal(run(F.NO_FILTERS, "kenya ode"), 1, "origin from the bag + grinder");
  assert.equal(run(F.NO_FILTERS, "blackcurrant"), 2, "the bag's tasting notes");
  assert.equal(run(F.NO_FILTERS, "cafe"), 1, "accents folded");
  assert.equal(run(F.NO_FILTERS, "finer"), 1, "notes");
  assert.equal(run(F.NO_FILTERS, "november"), 4, "month name");
  assert.equal(run(F.NO_FILTERS, "18g"), 1, "dose");
  assert.equal(run(f({ roaster: ["Paper Kite"] }), "kenya"), 0, "search and filters combine");
});

test("options count what each value would show given the other picks; picked values stay listed", () => {
  const flt = f({ grinder: ["ZP6"] });
  assert.deepEqual(opts("roaster", flt), [{ value: "Harbor Light", count: 1 }, { value: "Paper Kite", count: 1 }]);
  assert.deepEqual(opts("grinder", flt).map((o) => [o.value, o.count]), [["ZP6", 3], ["Ode Gen 2", 1]], "a facet's own pick doesn't narrow its counts");
  assert.ok(opts("grinder", f({ grinder: ["Comandante"] })).some((o) => o.value === "Comandante" && o.count === 0), "a picked value with no brews stays, so it can be unpicked");
  assert.deepEqual(opts("rating", F.NO_FILTERS).map((o) => o.value), ["5★", "3.5★", "3★", "Not rated"], "ratings from the top, half stars in place, Not rated last");
  let t = F.togglePick(F.NO_FILTERS, "origin", "Kenya");
  assert.equal(F.activeCount(F.setRange(t, "brewed", "2026-01-01", null)), 2);
  t = F.togglePick(t, "origin", "kenya");
  assert.equal(F.activeCount(t), 0, "toggling again removes it, whatever the case");
});

test("stash facets: tags match one by one, rest window from today and the settings, date ranges per field", () => {
  const levels = [{ id: "light", label: "Light", aliases: [], rest: 10, peakEnd: 45 }, { id: "medium", label: "Medium", aliases: [], rest: 5, peakEnd: 30 }];
  const today = "2026-11-24";
  assert.equal(S.restState("2026-11-20", "Light", today, levels), "resting");
  assert.equal(S.restState("2026-11-01", "Light", today, levels), "peak");
  assert.equal(S.restState("2026-09-01", "Light", today, levels), "past");
  assert.equal(S.restState("2026-11-20", "Light", today, levels, { light: { rest: 3, peakEnd: 20 } }), "peak", "your own window wins");
  assert.equal(S.restState(null, "Light", today, levels), null);
  const bag = (id, o) => ({ id, name: `Bag ${id}`, roaster: null, origin: null, processMethod: null, roastLevel: null, notes: null, roastDate: null, purchaseDate: null, openedDate: null, finishedDate: null, rating: null, price: null, remainingG: null, status: "unopened", tastingNotes: [], ...o });
  const list = [
    bag(1, { tastingNotes: ["Strawberry", "cacao"], rating: 4.5, status: "open", rest: "peak", purchaseDate: "2026-10-01" }),
    bag(2, { tastingNotes: ["strawberry"], rating: 3, rest: "resting", purchaseDate: "2026-11-20" }),
    bag(3, { tastingNotes: ["Lime"], purchaseDate: null }),
  ];
  const go = (flt) => list.filter((b) => F.matchesFilters(b, S.BAG_FACETS, S.BAG_DATES, flt)).map((b) => b.id).join(",");
  assert.equal(go(f({ notes: ["strawberry"] })), "1,2", "a tag matches any bag that has it, whatever the case");
  assert.equal(go(f({ notes: ["cacao", "lime"] })), "1,3");
  assert.equal(go(f({ rest: ["In its peak window"] })), "1");
  assert.equal(go(f({ status: ["Unopened"], rating: ["Not rated"] })), "3");
  assert.equal(go(f({}, { bought: { from: "2026-11-01" } })), "2", "a range leaves out bags without that date");
  const notes = F.facetOptions(list, S.BAG_FACETS, S.BAG_DATES, "notes", F.NO_FILTERS, () => true);
  assert.deepEqual(notes.map((o) => [o.value, o.count]), [["Strawberry", 2], ["cacao", 1], ["Lime", 1]], "tags counted once per bag, case folded");
});
