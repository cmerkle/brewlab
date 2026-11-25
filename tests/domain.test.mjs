// Domain checks for maths that must be exact. Run: npm run build:server && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertSetting, parseSetting, validateRanges, recommend, canGrind, rangeFor, toGrindNumber, dialToValue, valueToDial, fmtGrind, doseAdjustedGrind, shiftGrind, roastPercent, roastShift, dosePercent, DEFAULT_ROAST_NUDGE } from "../dist/shared/grind.js";
import { scaleSteps, applyRatio } from "../dist/shared/brew.js";
import { applyMatchingRules } from "../dist/server/rules.js";
import { switchOnExcludes } from "../dist/server/settings.js";
import { loadTasteDefaults } from "../dist/server/catalog.js";
import fs from "node:fs";
import { catalogRecipe } from "../dist/server/catalog.js";

// Example grinders and ranges (tests/fixtures/spec-grinders.json) — the worked examples are
// about the converter, not about what the gear library happens to ship.
const SPEC = JSON.parse(fs.readFileSync(new URL("./fixtures/spec-grinders.json", import.meta.url), "utf8"));
const lib = (id) => ({ id, name: SPEC[id].name, units: SPEC[id].units, grindRanges: SPEC[id].grindRanges });
const G = (id, name, units, grindRanges = null) => ({ id, name, units, grindRanges });
const zp6 = lib("zp6");
const k6 = lib("k6");
const kul = lib("k-ultra");
const ode = lib("ode-gen2");

test("worked example: Show Horse ZP6 5.0 → K6 90, K-Ultra 72, Ode 5 (~675 µm)", () => {
  const a = convertSetting(5.0, zp6, k6, "pourover");
  assert.ok(a.ok); assert.equal(a.value, 90); assert.equal(a.display, "90 clicks");
  const b = convertSetting(5.0, zp6, kul, "pourover");
  assert.ok(b.ok); assert.equal(b.value, 72); assert.equal(b.display, "72 clicks");
  const c = convertSetting(5.0, zp6, ode, "pourover");
  assert.ok(c.ok); assert.equal(c.value, 5); assert.equal(c.display, "5"); assert.equal(c.microns, 675);
  // and back
  const d = convertSetting(90, k6, zp6, "pourover");
  assert.ok(d.ok); assert.equal(d.display, "5.0 rotations");
});

test("unsupported combos show the guide note instead of a setting", () => {
  const r = convertSetting(30, kul, zp6, "espresso");
  assert.equal(r.ok, false); assert.equal(r.reason, "unsupported"); assert.match(r.message, /espresso/);
  const o = convertSetting(30, kul, ode, "espresso");
  assert.equal(o.ok, false); assert.equal(o.reason, "unsupported");
});

test("user grinder without ranges → no conversion data yet; with ranges → midpoint", () => {
  const none = G("new-one", "New One", "clicks");
  const r = convertSetting(5.0, zp6, none, "pourover");
  assert.equal(r.ok, false); assert.equal(r.reason, "no-data"); assert.match(r.message, /No conversion data yet/);
  const withR = G("c40", "Comandante C40", "clicks", { step: 1, methods: { pourover: { low: 20, high: 30 } } });
  const m = convertSetting(5.0, zp6, withR, "pourover");
  assert.ok(m.ok); assert.equal(m.value, 25);
  const back = convertSetting(25, withR, zp6, "pourover");
  assert.ok(back.ok); assert.equal(back.value, 5);
  assert.equal(recommend(none, "pourover").ok, false);
});

test("range validation names the method", () => {
  assert.match(validateRanges({ pourover: { low: 30, high: 20 } }), /Pour-over \(V60\).*above/);
  assert.match(validateRanges({ immersion: { low: 10, high: null } }), /French press \/ immersion.*both/);
  assert.equal(validateRanges({ pourover: { low: 20, high: 30 }, espresso: {} }), null);
});

test("parseSetting handles recorded strings", () => {
  assert.equal(parseSetting("5.0 rotations", zp6), 5);
  assert.equal(parseSetting("ZP6: 4.5-5", zp6), 4.75);
  assert.equal(parseSetting("72 clicks (dial 7.2)", kul), 72);
  assert.ok(Math.abs(parseSetting("setting 5.1", ode) - (5 + 1 / 3)) < 1e-9);
});

test("grind settings are plain numbers: the dial reading (Ode thirds 5.1 = 5⅓ on the linear scale)", () => {
  assert.equal(toGrindNumber("72 clicks (dial 7.2)", kul), 72);
  assert.equal(toGrindNumber("ZP6: 4.5-5", zp6), 4.8); // midpoint, rounded to the 0.1 step
  assert.equal(toGrindNumber("setting 5.1", ode), 5.1);
  assert.equal(toGrindNumber("88"), 88);
  assert.equal(toGrindNumber(5.5), 5.5);
  assert.equal(toGrindNumber("fine"), null);
  assert.equal(toGrindNumber(""), null);
  assert.ok(Math.abs(dialToValue(ode, 5.2) - (5 + 2 / 3)) < 1e-9);
  assert.equal(valueToDial(ode, 5 + 2 / 3), 5.2);
  assert.equal(valueToDial(ode, 5.99), 6);
  assert.equal(fmtGrind(5, zp6), "5.0 rotations");
  assert.equal(fmtGrind(88, kul), "88 clicks");
  assert.equal(fmtGrind(5.1, ode), "5.1");
  // Ode → ZP6 reads the Ode dial on its linear scale first
  const t = convertSetting(5.1, ode, zp6, "pourover");
  assert.ok(t.ok); assert.equal(t.value, 5.2); // 5⅓ is ⅔ through 4–6 → ⅔ through 4.5–5.5 = 5.17 → 5.2
});

test("dose nudge: drip methods go coarser for a bigger dose, finer for a smaller one", () => {
  // K-Ultra fixture pour-over 64–80 (16 clicks): doubling the dose → +20% → +3.2 → 3 clicks
  const up = doseAdjustedGrind(kul, "pourover", 72, 20, 40);
  assert.deepEqual(up, { dial: 75, delta: 3 });
  const down = doseAdjustedGrind(kul, "pourover", 72, 20, 10);
  assert.equal(down.dial, 69);
  assert.equal(doseAdjustedGrind(kul, "pourover", 72, 20, 20), null); // same dose
  assert.equal(doseAdjustedGrind(kul, "immersion", 80, 20, 40), null); // immersion isn't nudged
  assert.equal(doseAdjustedGrind(kul, "espresso", 30, 18, 20), null);
  assert.equal(doseAdjustedGrind(kul, "pourover", 72, 20, 21), null); // rounds away at a 1-click step
  // ZP6 fixture 4.5–5.5 rotations: 20 g → 30 g = +0.2 × log2(1.5) ≈ +0.117 → +0.1
  assert.equal(doseAdjustedGrind(zp6, "pourover", 5.0, 20, 30).dial, 5.1);
  // Ode thirds: 4–6 range, doubling → +0.4 → lands on the next third
  assert.equal(doseAdjustedGrind(ode, "pourover", 5, 20, 40).dial, 5.1);
  // No range for the method → no nudge
  assert.equal(doseAdjustedGrind(G("x", "X", "clicks"), "pourover", 10, 20, 40), null);
  // The settings: off, a different share per doubling, other methods.
  assert.equal(doseAdjustedGrind(kul, "pourover", 72, 20, 40, { enabled: false, percent: 20, methods: ["pourover"] }), null);
  assert.deepEqual(doseAdjustedGrind(kul, "pourover", 72, 20, 40, { enabled: true, percent: 50, methods: ["pourover"] }), { dial: 80, delta: 8 });
  assert.equal(doseAdjustedGrind(kul, "pourover", 72, 20, 40, { enabled: true, percent: 20, methods: ["immersion"] }), null);
  assert.ok(doseAdjustedGrind(kul, "immersion", 85, 20, 40, { enabled: true, percent: 20, methods: ["immersion"] }));
});

test("roast nudge: the grind moves by the bag's roast shift minus the recipe's (else the baseline's)", () => {
  const L = [
    { id: "light", label: "Light", grindShift: -5 }, { id: "medium-light", label: "Medium-light", grindShift: 0 },
    { id: "medium", label: "Medium", grindShift: 5 }, { id: "dark", label: "Dark", grindShift: 15 },
  ];
  const [light, ml, med, dark] = L;
  assert.equal(roastPercent("pourover", light, null, L), null); // off by default
  const ON = { ...DEFAULT_ROAST_NUDGE, enabled: true };
  // No recipe roast → the baseline (medium-light): a light bag goes 5% finer, a dark one 15% coarser.
  assert.deepEqual(roastPercent("pourover", light, null, L, ON), { percent: -5, from: ml, assumed: true });
  assert.equal(roastPercent("pourover", dark, null, L, ON).percent, 15);
  // A recipe written for medium: a light bag is 10% finer than it; the same roast → nothing.
  assert.deepEqual(roastPercent("pourover", light, med, L, ON), { percent: -10, from: med, assumed: false });
  assert.equal(roastPercent("pourover", med, med, L, ON), null);
  assert.equal(roastPercent("pourover", ml, null, L, ON), null); // bag = baseline
  assert.equal(roastPercent("pourover", null, med, L, ON), null); // the bag's roast isn't a known level
  // Settings: off, other methods, your own shifts, another baseline.
  assert.equal(roastPercent("pourover", light, null, L, { ...ON, enabled: false }), null);
  assert.equal(roastPercent("espresso", light, null, L, { ...ON, methods: ["pourover"] }), null);
  assert.equal(roastPercent("pourover", light, null, L, { ...ON, shifts: { light: -12 } }).percent, -12);
  assert.equal(roastShift(light, { ...ON, shifts: { light: -12 } }), -12);
  assert.equal(roastPercent("pourover", light, null, L, { ...ON, baseline: "dark" }).percent, -20);
  assert.equal(roastPercent("pourover", light, null, L, { ...ON, baseline: "nope" }), null);
  // Applied to a grinder: K-Ultra fixture pour-over 64–80 (16 clicks), −10% → −1.6 → 2 clicks finer.
  assert.deepEqual(shiftGrind(kul, "pourover", 72, -10), { dial: 70, delta: -2 });
  assert.equal(shiftGrind(kul, "pourover", 72, 0), null);
  // Roast and dose add up before rounding: −10% (lighter) + 20% (double dose) = +10% → +1.6 → 2 clicks coarser.
  assert.equal(shiftGrind(kul, "pourover", 72, -10 + dosePercent("pourover", 20, 40)).dial, 74);
});

test("Work Horse scaled to 35g / 460g pours ~229g then lands on 460g — not 560g", () => {
  const wh = catalogRecipe("work-horse");
  const s = scaleSteps(wh.steps, wh.waterG, 460);
  const targets = s.map((x) => x.targetWaterG);
  assert.ok(Math.abs(targets[0] - 229) <= 1, `first pour ${targets[0]}`);
  assert.equal(Math.max(...targets), 460);
  assert.equal(targets.at(-1), 460);
  assert.match(s[1].label, /460g/);
});

test("ratio toggles hold whichever amount was edited last (coffee by default)", () => {
  assert.deepEqual(applyRatio(20, 320, 2, null), { doseG: 20, waterG: 40 });
  assert.deepEqual(applyRatio(20, 320, 15, "dose"), { doseG: 20, waterG: 300 });
  assert.deepEqual(applyRatio(20, 320, 16, "water"), { doseG: 20, waterG: 320 });
  assert.deepEqual(applyRatio(20, 320, 13, "water"), { doseG: 24.6, waterG: 320 });
});

test("matching rules drop tried, avoided, and whatever switched-on Do-not-include tags match (cinnamon / co-ferment / funk)", () => {
  const ctx = {
    tastings: [{ name: "Finca Ejemplo", roaster: "Salt & Pepper Coffee Roasters" }],
    avoids: [{ name: "'Tis the Sample 2026", roaster: "Salt & Pepper Coffee Roasters" }],
    stash: [{ name: "Holiday Blend 2026", roaster: "Equator Coffees", status: "unopened" }],
    prefs: switchOnExcludes(loadTasteDefaults().prefs, ["cinnamon", "coferment", "funk"]),
  };
  const c = (o) => ({ kind: "pick", name: "X", roaster: "R", ...o });
  const { kept, dropped } = applyMatchingRules(
    [
      c({ name: "Finca Ejemplo", roaster: "Salt and Pepper" }),
      c({ name: "Tis the Sample 2026", roaster: "Salt & Pepper" }),
      c({ name: "Spiced Lot", processMethod: "Cinnamon anaerobic" }),
      c({ name: "Fruit Bomb", processMethod: "Red-fruits co-ferment" }),
      c({ name: "Holiday Blend 2026", roaster: "Equator" }),
      c({ name: "Clean Ethiopia", roaster: "Onyx", processMethod: "Washed", tastingNotes: "peach, jasmine" }),
      c({ name: "Anaerobic Gesha", roaster: "Onyx", processMethod: "Anaerobic natural", tastingNotes: "strawberry, cacao", funkRisk: "Moderate — clean anaerobic" }),
    ],
    ctx,
  );
  assert.deepEqual(kept.map((k) => k.name), ["Clean Ethiopia", "Anaerobic Gesha"]);
  assert.equal(dropped.length, 5);
});

import { extractFromHtml, draftFromOcrText } from "../dist/server/imports.js";

test("link import: JSON-LD product with a one-paragraph description splits fields at sentence ends", () => {
  const h = `<html><head><meta property="og:type" content="product"><script type="application/ld+json">{"@type":"Product","name":"Kenya Kiambu AA","brand":{"name":"Example Roasters"},"description":"Tasting notes: blackcurrant, grapefruit, demerara. Origin: Kenya. Process: Washed. Roast level: Light. 12 oz bag.","offers":{"price":"24.00"}}</script></head><body><main>x</main></body></html>`;
  const r = extractFromHtml(h, "http://x");
  assert.ok(r.found);
  assert.deepEqual(
    { ...r.draft, url: undefined },
    { name: "Kenya Kiambu AA", roaster: "Example Roasters", origin: "Kenya", processMethod: "Washed", roastLevel: "Light", tastingNotes: "blackcurrant, grapefruit, demerara", amountG: 340, price: 24, url: undefined },
  );
});

test("link import: labelled page text works; never invents a name without product markup", () => {
  const r = extractFromHtml('<html><body><main><h1>Ethiopia Guji</h1><p>Origin: Ethiopia, Guji zone</p><p>Process: Natural</p><p>Tasting Notes: Blueberry, jasmine | 12 oz</p></main></body></html>', "http://y");
  assert.ok(r.found);
  assert.equal(r.draft.origin, "Ethiopia, Guji zone");
  assert.equal(r.draft.processMethod, "Natural");
  assert.equal(r.draft.name, undefined);
});

test("link import: non-product page → honest empty state", () => {
  const r = extractFromHtml('<html><head><meta property="og:type" content="website"><meta property="og:title" content="About us"></head><body><main><p>We make furniture.</p></main></body></html>', "http://z");
  assert.equal(r.found, false);
  assert.equal(r.message, "No coffee details were found on that page.");
});

test("photo OCR text → draft", () => {
  const d = draftFromOcrText("ONYX COFFEE LAB\nCoffee: Southern Weather\nRoaster: Onyx Coffee Lab\nOrigin: Colombia\nProcess: Washed\nMedium Light Roast\nRoasted on: 11/10/2026\nNet wt 12 oz");
  assert.equal(d.name, "Southern Weather");
  assert.equal(d.roaster, "Onyx Coffee Lab");
  assert.equal(d.roastDate, "2026-11-10");
  assert.equal(d.amountG, 340);
});

import { extractFromShopify, importFromLink } from "../dist/server/imports.js";
import http from "node:http";

const SHOP_PRODUCT = {
  title: "Selfnovation – Costa Rican Milenio Single Origin",
  vendor: "Turtle Beans",
  type: "Coffee",
  tags: ["Costa Rica", "Experimental", "Light Roast", "Single Origin"],
  price: 2400,
  variants: [{ title: "12 oz / Whole Bean", option1: "12 oz", price: 2400, available: true }, { title: "2 lb / Whole Bean", option1: "2 lb", price: 6000, available: true }],
  // Label and value in separate elements — the layout the old extractor missed.
  description: "<p>A bright, sweet lot from the Milenio farm.</p><div class='specs'><div><h5>Region</h5><p>Tarrazú</p></div><div><h5>Producer</h5><p>Finca Milenio</p></div><div><h5>Variety</h5><p>Catuaí, Caturra</p></div><div><h5>Altitude</h5><p>1,700 masl</p></div><div><h5>Process</h5><p>Anaerobic Honey</p></div><div><h5>Tasting Notes</h5><p>Strawberry, panela, cacao nib</p></div></div>",
};

test("Shopify product data: separate-element labels, tags, variants, price", () => {
  const d = extractFromShopify(SHOP_PRODUCT, "https://x/products/selfnovation");
  assert.equal(d.name, "Selfnovation – Costa Rican Milenio Single Origin");
  assert.equal(d.roaster, "Turtle Beans");
  assert.equal(d.origin, "Costa Rica"); // from tags (description has no Origin label)
  assert.equal(d.processMethod, "Anaerobic Honey");
  assert.equal(d.tastingNotes, "Strawberry, panela, cacao nib");
  assert.equal(d.roastLevel, "Light");
  assert.equal(d.price, 24);
  assert.equal(d.amountG, 340);
  assert.equal(d.details, "Region: Tarrazú · Producer: Finca Milenio · Variety: Catuaí, Caturra · Altitude: 1,700 masl");
  assert.equal(d.evidence, true);
});

test("page markup: <dt>/<dd> list and table rows", () => {
  const dl = extractFromHtml('<html><head><meta property="og:type" content="product"><meta property="og:title" content="Gesha Village"></head><body><main><h1>Gesha Village</h1><dl><dt>Origin</dt><dd>Ethiopia</dd><dt>Process</dt><dd>Natural</dd><dt>Tasting notes</dt><dd>Jasmine, bergamot</dd></dl></main></body></html>', "http://y");
  assert.ok(dl.found);
  assert.equal(dl.draft.origin, "Ethiopia");
  assert.equal(dl.draft.processMethod, "Natural");
  assert.equal(dl.draft.tastingNotes, "Jasmine, bergamot");
  const tbl = extractFromHtml('<html><head><meta property="og:type" content="product"><meta property="og:title" content="Kenya AA coffee"></head><body><main><table><tr><td>Country</td><td>Kenya</td></tr><tr><td>Varietal</td><td>SL28</td></tr><tr><td>Roast</td><td>Light</td></tr></table></main></body></html>', "http://z");
  assert.equal(tbl.draft.origin, "Kenya");
  assert.equal(tbl.draft.roastLevel, "Light");
  assert.match(tbl.draft.details, /Variety: SL28/);
});

test("link import end-to-end: Shopify data used even when the page itself is blocked (429)", async () => {
  const srv = http.createServer((req, res) => {
    if (req.url.endsWith(".js")) { res.writeHead(200, { "content-type": "application/javascript" }); return res.end(JSON.stringify(SHOP_PRODUCT)); }
    res.writeHead(429, { "content-type": "text/plain" }); res.end("Too Many Requests");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  process.env.IMPORT_ALLOW_HOSTS = "127.0.0.1";
  try {
    const r = await importFromLink(`http://127.0.0.1:${srv.address().port}/products/selfnovation-costa-rican-milenio-single-origin`);
    assert.ok(r.found, r.message);
    assert.equal(r.draft.origin, "Costa Rica");
    assert.equal(r.draft.processMethod, "Anaerobic Honey");
    assert.equal(r.draft.amountG, 340);
    assert.ok(r.fields.length >= 8, `fields: ${r.fields.join(", ")}`);
  } finally {
    delete process.env.IMPORT_ALLOW_HOSTS;
    srv.close();
  }
});

test("non-product page with an infobox table (label/value cells) stays an honest empty state", () => {
  const r = extractFromHtml('<html><head><meta property="og:type" content="website"><meta property="og:title" content="Espresso"></head><body><main><h1>Espresso</h1><table class="infobox"><tr><th>Country of origin</th><td>Italy</td></tr><tr><th>Process</th><td>Pressurised brewing</td></tr><tr><th>Notes</th><td>Strong coffee</td></tr></table><p>Espresso is a concentrated form of coffee.</p></main></body></html>', "https://en.wikipedia.org/wiki/Espresso");
  assert.equal(r.found, false, JSON.stringify(r.draft));
  assert.equal(r.message, "No coffee details were found on that page.");
});

test("can-do: a method the grinder can't do has no range and says so in conversions", () => {
  const filter = { id: "f", name: "Filter Mill", units: "clicks", grindRanges: { methods: { pourover: { low: 20, high: 30 }, espresso: { low: 1, high: 2 } }, unsupported: ["espresso"], notes: { espresso: "Burrs too coarse." } } };
  const any = { id: "a", name: "Any Mill", units: "clicks", grindRanges: { methods: { pourover: { low: 60, high: 80 }, espresso: { low: 10, high: 20 } } } };
  assert.equal(canGrind(filter, "espresso"), false);
  assert.equal(canGrind(filter, "pourover"), true);
  assert.equal(rangeFor(filter, "espresso"), null); // a stray range is ignored
  const r = convertSetting(15, any, filter, "espresso");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unsupported");
  assert.equal(r.message, "Filter Mill can't grind for Espresso. Burrs too coarse.");
  assert.equal(recommend(filter, "espresso").reason, "unsupported");
  assert.equal(convertSetting(70, any, filter, "pourover").ok, true);
});
