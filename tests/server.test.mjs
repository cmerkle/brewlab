// Server-side safety & data tests: SSRF guard, backups/rotation, schema migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-test-"));
process.env.DATA_DIR = tmp;
process.env.BACKUP_DIR = path.join(tmp, "backups");
process.env.BACKUP_KEEP = "3";

const { isPrivateAddress, importFromLink } = await import("../dist/server/imports.js");
const { openDb } = await import("../dist/server/db.js");
const { createBackup, listBackups, exportAll } = await import("../dist/server/backup.js");

test("private / local addresses are refused by the link importer", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "0.0.0.0", "100.64.0.1", "100.127.255.1", "169.254.169.254", "172.16.0.1", "172.31.9.9", "192.168.1.1", "224.0.0.1", "::1", "::", "fd12::1", "fe80::1", "::ffff:192.168.0.1", "[::1]"])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.1", "172.32.0.1", "2606:4700::1111"])
    assert.equal(isPrivateAddress(ip), false, ip);
});

test("link import refuses local targets but honours IMPORT_ALLOW_HOSTS", async () => {
  for (const u of ["http://127.0.0.1:9/", "http://localhost/", "http://[::1]/", "http://printer.local/", "http://10.0.0.5/admin"]) {
    const r = await importFromLink(u);
    assert.equal(r.found, false);
    assert.match(r.message, /private or local network/, u);
  }
  process.env.IMPORT_ALLOW_HOSTS = "127.0.0.1";
  const r = await importFromLink("http://127.0.0.1:9/");
  assert.doesNotMatch(r.message, /private or local network/); // allowed through (then fails to connect)
  delete process.env.IMPORT_ALLOW_HOSTS;
});

test("migration adds inventory_items.photo to a database created by an older version", () => {
  const file = path.join(tmp, "old.db");
  const old = new Database(file);
  old.exec("CREATE TABLE inventory_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, roaster TEXT, origin TEXT, processMethod TEXT, roastLevel TEXT, roastDate TEXT, purchaseDate TEXT, openedDate TEXT, finishedDate TEXT, amountG REAL, price REAL, url TEXT, rating INTEGER, notes TEXT, source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'unopened', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)");
  old.prepare("INSERT INTO inventory_items (name, createdAt, updatedAt) VALUES ('Old bag', 'x', 'x')").run();
  old.close();
  const db = openDb(file);
  const cols = db.prepare("PRAGMA table_info(inventory_items)").all().map((c) => c.name);
  assert.ok(cols.includes("photo"));
  assert.equal(db.prepare("SELECT name FROM inventory_items").get().name, "Old bag"); // data kept
  openDb(file).close(); // idempotent
  db.close();
});

test("backups are valid SQLite copies and rotate to BACKUP_KEEP", async () => {
  const db = openDb(path.join(tmp, "live.db"));
  db.prepare("INSERT INTO tastings (name, verdict, createdAt) VALUES ('Test', 'liked', 'x')").run();
  for (let i = 0; i < 5; i++) {
    await createBackup(db, "manual");
    await new Promise((r) => setTimeout(r, 1100)); // distinct timestamped names
  }
  const list = listBackups();
  assert.equal(list.length, 3);
  const copy = new Database(path.join(process.env.BACKUP_DIR, list[0].name), { readonly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) n FROM tastings").get().n, 1);
  assert.equal(copy.pragma("integrity_check", { simple: true }), "ok");
  copy.close();
  const ex = exportAll(db);
  assert.equal(ex.app, "brewlab");
  assert.equal(ex.tastings.length, 1);
  db.close();
});
