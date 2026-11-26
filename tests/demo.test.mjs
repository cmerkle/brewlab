// The online demo (DEMO=1): a private copy of the demo data per visitor, and nothing that writes
// outside that copy or calls out to the internet.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A data folder that must never appear: the demo doesn't write to it.
const DATA_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-demo-")), "data");
process.env.DATA_DIR = DATA_DIR;
process.env.SEED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));
process.env.DEMO = "1";
process.env.DEMO_NEW_PER_IP = "6";
process.env.DEMO_MAX_SANDBOXES = "4";
process.env.TRUST_PROXY_HOPS = "0";

const { demoApp, blocked } = await import("../dist/server/demo.js");
const demo = await demoApp();
const server = demo.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
after(() => { server.close(); demo.close(); });

/** A browser: keeps the cookie it's given. */
const visitor = () => {
  let cookie = "";
  return async (method, url, body) => {
    const r = await fetch(BASE + url, {
      method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: r.status, set, json: r.headers.get("content-type")?.includes("json") ? await r.json() : null };
  };
};

test("each visitor gets their own copy of the demo, with history, already set up", async () => {
  const a = visitor(), b = visitor();
  const page = await a("GET", "/");
  assert.match(page.set, /^brewlab_demo=[A-Za-z0-9_-]{24}; Path=\/; HttpOnly; SameSite=Lax/);
  const setup = (await a("GET", "/api/setup")).json;
  const health = (await a("GET", "/api/health")).json;
  assert.ok(health.counts.brews > 100 && health.ocr === false, "a visitor's health is their copy's (Settings shows it)");
  const monitor = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(monitor.demo, true, "a monitor without a cookie gets the summary");
  assert.equal(setup.onboarded, true);
  assert.equal(setup.demo.idleMinutes, 60);
  const brewsA = (await a("GET", "/api/brews")).json;
  const brewsB = (await b("GET", "/api/brews")).json;
  assert.ok(brewsA.length > 100, `five months of history (${brewsA.length} brews)`);
  assert.equal(brewsA.length, brewsB.length);
  assert.equal((await a("DELETE", `/api/brews/${brewsA[0].id}`)).status, 200);
  await a("PUT", "/api/settings", { defaultRatio: 13 });
  assert.equal((await a("GET", "/api/brews")).json.length, brewsA.length - 1);
  assert.equal((await b("GET", "/api/brews")).json.length, brewsB.length, "the other visitor's copy is untouched");
  assert.equal((await b("GET", "/api/setup")).json.settings.defaultRatio, 16);
});

test("what would write outside the copy or call out is turned away", async () => {
  const a = visitor();
  for (const [m, u] of [["POST", "/api/import/photo"], ["POST", "/api/import/link"], ["POST", "/api/import/lookup"],
    ["GET", "/api/ai"], ["PUT", "/api/ai"], ["POST", "/api/ai/test"], ["GET", "/api/backups"], ["POST", "/api/backups"],
    ["PUT", "/api/backups/retention"], ["POST", "/api/about/check"], ["POST", "/api/setup/restore"], ["GET", "/metrics"], ["GET", "/uploads/a.jpg"]]) {
    const r = await a(m, u, m === "GET" ? undefined : {});
    assert.equal(r.status, 403, `${m} ${u}`);
    assert.match(r.json.error, /online demo/);
  }
  assert.ok(blocked("GET", "/api/backups/brewlab-x.db"));
  assert.ok(!blocked("GET", "/api/export") && !blocked("POST", "/api/discover/refresh") && !blocked("GET", "/api/about"));
  assert.equal((await a("GET", "/api/export")).status, 200, "exporting your own copy still works");
});

test("sandboxes are capped, and new ones per address are rate-limited", async () => {
  // 6 per address per hour: two visitors above plus these.
  const made = [];
  for (let i = 0; i < 6; i++) made.push((await visitor()("GET", "/api/recipes")).status);
  assert.ok(made.includes(429), `the address runs out of new sessions (${made.join(",")})`);
  assert.ok(demo.sandboxes() <= 4, `at most DEMO_MAX_SANDBOXES copies (${demo.sandboxes()})`);
});

test("the demo never uses an AI provider, even with a key in the environment", async () => {
  const { llmConfig } = await import("../dist/server/llm.js");
  process.env.LLM_API_KEY = "sk-test-not-a-real-key";
  try {
    assert.equal(llmConfig().enabled, false);
  } finally {
    delete process.env.LLM_API_KEY;
  }
});

test("nothing was written to the data folder", () => {
  assert.equal(fs.existsSync(DATA_DIR), false);
});
