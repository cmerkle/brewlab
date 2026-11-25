// Ratings go in half stars: 0.5–5 in steps of 0.5, for brews and Stash bags.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-rating-"));
process.env.DATA_DIR = tmp;
process.env.SEED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));
const { createApp } = await import("../dist/server/app.js");
const { openDb } = await import("../dist/server/db.js");

test("half-star ratings save and read back; other fractions and out-of-range values are refused", async () => {
  const db = openDb(path.join(tmp, "brewlab.db"));
  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  try {
    let r = await call("POST", "/api/brews", { coffee: "Test", doseG: 15, waterG: 250, rating: 3.5, brewedAt: new Date().toISOString() });
    assert.ok(r.status < 300 && r.body.id, JSON.stringify(r.body));
    const id = r.body.id;
    assert.equal((await (await fetch(`${base}/api/brews`)).json()).find((b) => b.id === id).rating, 3.5, "stored as 3.5, not rounded");
    r = await call("PUT", `/api/brews/${id}`, { rating: 0.5 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const bad of [3.3, 0, 5.5, 6]) {
      r = await call("POST", "/api/brews", { coffee: "Test", doseG: 15, waterG: 250, rating: bad, brewedAt: new Date().toISOString() });
      assert.equal(r.status, 400, `rating ${bad} refused`);
      assert.match(r.body.error, /half stars|½–5/);
    }
    r = await call("POST", "/api/inventory", { name: "Half bag", rating: 4.5 });
    assert.ok(r.body.id, JSON.stringify(r.body));
    assert.equal((await (await fetch(`${base}/api/inventory`)).json()).find((b) => b.id === r.body.id).rating, 4.5);
    assert.equal((await (await fetch(`${base}/api/schema`)).json()).limits?.rating?.step ?? (await (await fetch(`${base}/api/schema`)).json()).rating?.step, 0.5, "the form limits come from the server");
  } finally {
    server.close();
  }
});
