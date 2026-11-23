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
  assert.equal(hoff.grindSetting, "24 clicks"); // position 0.3 inside 22–28 → 23.8 → 24
  assert.equal(tpls.filter((t) => t.name === "Show Horse" || t.name.startsWith("Show Horse")).length, 1, "one Show Horse per brewer");
  assert.ok(!tpls.some((t) => /aeropress|french/i.test(t.id)), "only recipes this gear can brew");
  const made = (await call("POST", "/api/recipes/from-templates", { ids: ["hoffmann-v60", "kasuya-4-6"] })).body;
  assert.equal(made.created.length, 2);
  assert.equal(made.created[0].grindSetting, "24 clicks");
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
