// Phase 3: Discover for everyone — taste summary, ranking without AI, avoid-rule toggles and
// suggestions, write-only AI credentials, and taste settings carried over from seed data.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-taste-"));
const noSeed = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));
process.env.DATA_DIR = tmp;
process.env.SEED_DIR = noSeed;
for (const k of ["LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL"]) delete process.env[k];

const { createApp } = await import("../dist/server/app.js");
const { openDb } = await import("../dist/server/db.js");
const { tasteSummary, tasteProfileText, featuresOf } = await import("../dist/server/taste.js");
const { getSettings, setSettings, applySeedTaste } = await import("../dist/server/settings.js");
const { SECRETS_FILE } = await import("../dist/server/secrets.js");

async function start(file) {
  const db = openDb(path.join(tmp, file));
  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  };
  const stop = () => { server.closeAllConnections(); server.close(); };
  return { db, call, stop };
}
const t0 = new Date().toISOString();
const tasting = (db, name, roaster, origin, processMethod, verdict, notes = null) =>
  db.prepare("INSERT INTO tastings (name, roaster, origin, processMethod, verdict, notes, createdAt) VALUES (?,?,?,?,?,?,?)").run(name, roaster, origin, processMethod, verdict, notes, t0);
const cand = (name, origin, processMethod, tastingNotes = "", kind = "pick") =>
  ({ kind, name, roaster: "Test Roasters", origin, processMethod, tastingNotes, roastLevel: "Light", priceAmount: 20, priceText: "$20", url: "", whyFit: "", brewTip: "", funkRisk: "low" });

test("features: origin, process, roast and note keywords", () => {
  const f = featuresOf({ name: "Guji Natural", origin: "Guji", processMethod: "Natural", roastLevel: "Light", tastingNotes: "blueberry, jasmine" }).map((x) => `${x.kind}:${x.name}`);
  for (const want of ["origin:Ethiopia", "process:natural", "roast:light", "note:berry", "note:floral"]) assert.ok(f.includes(want), want);
});

test("stages: 0 rated → popular, 1–4 → mixed, 5+ → tailored; the prompt says which", async () => {
  const { db, stop } = await start("stages.db");
  let s = tasteSummary(db);
  assert.equal(s.stage, "popular");
  assert.match(tasteProfileText(s, getSettings(db)), /NO ratings yet.*widely loved, approachable/s);
  tasting(db, "Aricha", "A", "Ethiopia", "Natural", "loved");
  tasting(db, "Kochere", "B", "Ethiopia", "Natural", "loved");
  s = tasteSummary(db);
  assert.equal(s.stage, "mixed");
  assert.ok(s.likes.some((a) => a.kind === "process" && a.name === "natural" && a.n === 2 && a.avg === 5));
  const text = tasteProfileText(s, getSettings(db));
  assert.match(text, /about half the picks popular/);
  assert.match(text, /natural process: 2 coffees, avg 5★/);
  assert.match(text, /Never invent ratings/);
  for (const n of ["C", "D", "E"]) tasting(db, n, "X", "Brazil", "Washed", "liked");
  assert.equal(tasteSummary(db).stage, "tailored");
  stop();
});

test("ratings merge across Stash, brews and tastings for the same coffee", async () => {
  const { db, stop } = await start("merge.db");
  const bag = db.prepare("INSERT INTO inventory_items (name, roaster, origin, processMethod, rating, status, source, createdAt, updatedAt) VALUES ('Hillside Natural','Salt & Pepper','Ethiopia','Natural',5,'open','manual',?,?)").run(t0, t0);
  db.prepare("INSERT INTO brews (coffee, inventoryId, rating, brewedAt) VALUES ('Hillside Natural', ?, 3, ?)").run(bag.lastInsertRowid, t0);
  tasting(db, "Hillside Natural", "Salt and Pepper Coffee", "Ethiopia", "Natural", "loved");
  const cs = tasteSummary(db).coffees;
  assert.equal(cs.length, 1);
  assert.equal(cs[0].score, 4.3); // (5 + 3 + 5) / 3
  assert.equal(cs[0].sources.length, 3);
  stop();
});

test("without AI: entered candidates are ranked by the taste summary, each with its reason", async () => {
  const { db, call, stop } = await start("rank.db");
  tasting(db, "Aricha", "A", "Ethiopia", "Natural", "loved");
  tasting(db, "Kochere", "B", "Ethiopia", "Natural", "loved");
  tasting(db, "Smoky", "C", "Sumatra", "Wet-hulled", "disliked");
  const r = await call("POST", "/api/discover/refresh", { candidates: [
    cand("Mandheling", "Sumatra", "Wet-hulled"), cand("Colombia Huila", "Colombia", "Washed"), cand("Banko Gotiti", "Ethiopia", "Natural"),
    cand("Wild one", "Panama", "Anaerobic", "", "wildcard"),
  ] });
  assert.equal(r.status, 200, r.text);
  const names = r.body.kept.map((c) => c.name);
  assert.deepEqual(names, ["Banko Gotiti", "Colombia Huila", "Mandheling", "Wild one"]); // wildcard stays last
  assert.match(r.body.kept[0].whyFit, /You rated 2 natural process coffees 5★ on average|You rated 2 Ethiopia coffees 5★/);
  assert.match(r.body.kept[2].whyFit, /Heads-up/);
  stop();
});

test("avoid rules are toggles (off on a new install) and suggestions are offered, never applied", async () => {
  const { db, call, stop } = await start("rules.db");
  assert.deepEqual(getSettings(db).avoidRules, []);
  let check = (await call("POST", "/api/discover/rules/check", cand("Cinnamon Co-ferment", "Colombia", "Co-ferment", "cinnamon"))).body;
  assert.equal(check.kept.length, 1, "nothing excluded until the user turns rules on");
  tasting(db, "Cinnamon Bomb", "A", "Colombia", "Washed", "disliked", "very cinnamon");
  tasting(db, "Spice Cake", "B", "Colombia", "Washed", "not_for_me", "cinnamon heavy");
  const taste = (await call("GET", "/api/discover/taste")).body;
  const sug = taste.suggestions.find((x) => x.id === "cinnamon");
  assert.ok(sug, "suggests avoiding cinnamon");
  assert.match(sug.text, /You rated 2 of them 2★ or lower/);
  assert.deepEqual(getSettings(db).avoidRules, [], "not applied silently");
  await call("POST", "/api/discover/suggestions/cinnamon", { accept: true });
  assert.deepEqual(getSettings(db).avoidRules, ["cinnamon"]);
  check = (await call("POST", "/api/discover/rules/check", cand("Cinnamon Thing", "Colombia", "Washed", "cinnamon"))).body;
  assert.equal(check.dropped[0].reason, "profile: cinnamon-forward");
  assert.ok(!(await call("GET", "/api/discover/taste")).body.suggestions.some((x) => x.id === "cinnamon"));
  stop();
});

test("an install's taste settings carry over once from its seed taste.json", async () => {
  const db = openDb(path.join(tmp, "seeded-taste.db"));
  const dir = path.resolve("tests/fixtures/taste");
  assert.equal(applySeedTaste(db, dir), true);
  const s = getSettings(db);
  assert.match(s.palateNotes, /bright, juicy washed/);
  assert.deepEqual(s.avoidRules, ["cinnamon", "coferment", "funk"]);
  setSettings(db, { avoidRules: [] });
  assert.equal(applySeedTaste(db, dir), false, "only once — later edits stick");
  assert.deepEqual(getSettings(db).avoidRules, []);
  db.close();
});

test("AI credentials: saved in a separate file, never returned, not in the export; errors scrub the key", async () => {
  // A fake OpenAI-compatible server that rejects the key and echoes it (as real providers do).
  const fake = http.createServer((req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Incorrect API key provided: sk-supersecret-123456. Check it." } }));
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const { call, stop } = await start("ai.db");
  assert.equal((await call("GET", "/api/ai")).body.source, "none");
  assert.equal((await call("PUT", "/api/ai", { provider: "openai", apiKey: "sk-x" })).status, 400, "OpenAI needs a model id");
  const saved = await call("PUT", "/api/ai", { provider: "openai-compatible", apiKey: "sk-supersecret-123456", model: "m", baseUrl: `http://127.0.0.1:${fake.address().port}/v1` });
  assert.equal(saved.status, 200, saved.text);
  assert.ok(!saved.text.includes("supersecret"), "PUT response has no key");
  const view = await call("GET", "/api/ai");
  assert.equal(view.body.source, "app");
  assert.equal(view.body.saved.hasKey, true);
  assert.ok(!view.text.includes("supersecret"), "GET has no key");
  assert.equal(fs.statSync(SECRETS_FILE).mode & 0o777, 0o600);
  assert.ok(!(await call("GET", "/api/export")).text.includes("supersecret"), "export has no key");
  assert.ok(!(await call("GET", "/api/health")).text.includes("supersecret"));
  // Blank key keeps the saved one.
  await call("PUT", "/api/ai", { provider: "openai-compatible", apiKey: "", model: "m2", baseUrl: `http://127.0.0.1:${fake.address().port}/v1` });
  assert.match(fs.readFileSync(SECRETS_FILE, "utf8"), /supersecret/);
  const t = await call("POST", "/api/ai/test");
  assert.equal(t.status, 502);
  assert.ok(!t.text.includes("supersecret"), `test error scrubbed: ${t.text}`);
  assert.match(t.body.error, /\[key\]/);
  // Environment variables take precedence over the saved settings.
  process.env.LLM_API_KEY = "env-key";
  assert.equal((await call("GET", "/api/ai")).body.source, "environment");
  delete process.env.LLM_API_KEY;
  assert.equal((await call("DELETE", "/api/ai")).body.source, "none");
  assert.ok(!fs.existsSync(SECRETS_FILE));
  stop();
  fake.closeAllConnections();
  fake.close();
});
