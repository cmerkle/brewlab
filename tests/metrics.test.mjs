// Prometheus metrics: off by default (404), then valid text format with numbers that match the data.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-metrics-"));
process.env.DATA_DIR = tmp;
process.env.BACKUP_DIR = path.join(tmp, "backups");
process.env.SEED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));

const { createApp } = await import("../dist/server/app.js");
const { openDb } = await import("../dist/server/db.js");
const { render } = await import("../dist/server/metrics.js");

/** name{labels} → value, for the lines that aren't comments. */
function parse(text) {
  const m = new Map();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.lastIndexOf(" ");
    m.set(line.slice(0, i), Number(line.slice(i + 1)));
  }
  return m;
}

test("label values are escaped; missing ones read none", () => {
  const t = render([{ name: "x", help: "h", type: "gauge", samples: [{ labels: { a: 'say "hi"\\\n', b: null }, value: 1.23456 }] }]);
  assert.equal(t, '# HELP x h\n# TYPE x gauge\nx{a="say \\"hi\\"\\\\\\n",b="none"} 1.235\n');
});

test("/metrics: off by default, then brews, grams, dimensions and the stash", async () => {
  const db = openDb(path.join(tmp, "brewlab.db"));
  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, url, body) => fetch(base + url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    let r = await fetch(base + "/metrics");
    assert.equal(r.status, 404, "off until switched on");
    await json("PUT", "/api/settings", { metrics: true });

    const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; // local, like the app
    const today = day(new Date());
    const five = new Date(); five.setDate(five.getDate() - 5);
    const roast = day(five);
    const bag = await json("POST", "/api/inventory", { name: "Test Kenya", roaster: "Example Roasters", origin: "Kenya", roastLevel: "Light", processMethod: "Washed", amountG: 250, price: 20, roastDate: roast, purchaseDate: today, openedDate: today });
    assert.ok(bag.id, JSON.stringify(bag));
    for (const [dose, rating] of [[15, 5], [18, 3]]) {
      const b = await json("POST", "/api/brews", { recipeName: "V60", brewerName: "Hario V60", grinderName: "Test Grinder", method: "pourover", coffee: "Test Kenya", inventoryId: bag.id, doseG: dose, waterG: 250, rating, brewedAt: new Date().toISOString() });
      assert.ok(b.id, JSON.stringify(b));
    }
    await json("POST", "/api/brews", { recipeName: "Espresso", method: "espresso", coffee: "Something else", doseG: 18, waterG: 36, brewedAt: new Date().toISOString() });

    r = await fetch(base + "/metrics");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /^text\/plain;.*version=0\.0\.4/);
    const text = await r.text();
    for (const line of text.split("\n").filter((l) => l && !l.startsWith("#")))
      assert.match(line, /^brewlab_[a-z_]+(\{([a-z_]+="([^"\\]|\\.)*",?)*\})? (-?[\d.]+(e[+-]?\d+)?|NaN|[+-]Inf)$/, `valid sample line: ${line}`);
    const m = parse(text);
    assert.equal(m.get("brewlab_brews_total"), 3);
    assert.equal(m.get("brewlab_coffee_used_grams_total"), 51);
    assert.equal(m.get('brewlab_brews_window{window="today"}'), 3);
    assert.equal(m.get('brewlab_brews_by_roaster_total{roaster="Example Roasters"}'), 2);
    assert.equal(m.get('brewlab_brews_by_roaster_total{roaster="none"}'), 1, "a brew without a Stash bag");
    assert.equal(m.get('brewlab_coffee_used_by_origin_grams_total{origin="Kenya"}'), 33);
    assert.equal(m.get('brewlab_coffee_used_by_method_grams_total{method="Espresso"}'), 18);
    assert.equal(m.get('brewlab_brew_rating_average_by_grinder{grinder="Test Grinder"}'), 4);
    assert.equal(m.get('brewlab_brews_by_rating_total{rating="none"}'), 1);
    assert.equal(m.get('brewlab_bags{status="open"}'), 1);
    assert.equal(m.get("brewlab_stash_remaining_grams"), 217);
    const bagKey = (name) => [...m.keys()].find((k) => k.startsWith(name + "{") && k.includes('name="Test Kenya"'));
    assert.equal(m.get(bagKey("brewlab_bag_remaining_grams")), 217);
    assert.equal(m.get(bagKey("brewlab_bag_days_off_roast")), 5);
    assert.ok(bagKey("brewlab_bag_freshness").includes('state="'), "the rest window state is a label");
    assert.equal(m.get("brewlab_spent_total"), 20);
    assert.equal(m.get("brewlab_brewing_streak_days"), 1);
    assert.ok([...m.keys()].some((k) => k.startsWith("brewlab_info{version=")));
  } finally {
    server.close();
  }
});
