// More → Backups: delete one backup, and the retention setting (how many to keep).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-backup-"));
process.env.DATA_DIR = tmp;
process.env.BACKUP_DIR = path.join(tmp, "backups");
process.env.BACKUP_KEEP = "4";
process.env.SEED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));

const { createApp } = await import("../dist/server/app.js");
const { openDb } = await import("../dist/server/db.js");

/** Fake snapshots, oldest first, a day apart (only the name and mtime matter for listing). */
function fakeBackups(days) {
  fs.mkdirSync(process.env.BACKUP_DIR, { recursive: true });
  for (const d of days) {
    const f = path.join(process.env.BACKUP_DIR, `brewlab-2026-01-${String(d).padStart(2, "0")}.db`);
    fs.writeFileSync(f, "x");
    const t = new Date(Date.UTC(2026, 0, d));
    fs.utimesSync(f, t, t);
  }
}

test("backups: delete one, change how many are kept, back to the default", async () => {
  const db = openDb(path.join(tmp, "brewlab.db"));
  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const names = async () => (await call("GET", "/api/backups")).body.backups.map((b) => b.name);
  try {
    fakeBackups([1, 2, 3]);
    let r = await call("GET", "/api/backups");
    assert.equal(r.body.keep, 4);
    assert.equal(r.body.keepDefault, 4);
    assert.equal(r.body.custom, false);

    // Delete one
    r = await call("DELETE", "/api/backups/brewlab-2026-01-02.db");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.backups.map((b) => b.name), ["brewlab-2026-01-03.db", "brewlab-2026-01-01.db"]);
    assert.equal((await call("DELETE", "/api/backups/brewlab-2026-01-02.db")).status, 404);
    // Only backup names: no paths, no other files
    assert.equal((await call("DELETE", "/api/backups/..%2Fbrewlab.db")).status, 404);
    assert.equal((await call("DELETE", "/api/backups/brewlab.db")).status, 404);
    assert.ok(fs.existsSync(path.join(tmp, "brewlab.db")));

    // Retention: keeping 2 of 5 removes the 3 oldest right away
    fakeBackups([4, 5, 6]);
    assert.equal((await names()).length, 5);
    r = await call("PUT", "/api/backups/retention", { keep: 2 });
    assert.equal(r.status, 200);
    assert.equal(r.body.keep, 2);
    assert.equal(r.body.custom, true);
    assert.deepEqual(r.body.removed.sort(), ["brewlab-2026-01-01.db", "brewlab-2026-01-03.db", "brewlab-2026-01-04.db"]);
    assert.deepEqual(await names(), ["brewlab-2026-01-06.db", "brewlab-2026-01-05.db"]);
    assert.equal((await call("GET", "/api/setup")).body.settings.backupKeep, 2);

    // A new backup respects the setting
    r = await call("POST", "/api/backups");
    assert.equal(r.status, 200);
    const after = await names();
    assert.equal(after.length, 2);
    assert.equal(after[0], r.body.name);

    // Bad values are refused and change nothing
    for (const keep of [0, 366, 2.5, "3", undefined]) assert.equal((await call("PUT", "/api/backups/retention", { keep })).status, 400, String(keep));
    assert.equal((await call("GET", "/api/backups")).body.keep, 2);

    // Back to the default (BACKUP_KEEP)
    r = await call("PUT", "/api/backups/retention", { keep: null });
    assert.equal(r.body.keep, 4);
    assert.equal(r.body.custom, false);
    assert.deepEqual(r.body.removed, []);
  } finally {
    server.close();
    db.close();
  }
});
