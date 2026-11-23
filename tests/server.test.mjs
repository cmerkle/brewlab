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

/* ---------- look a bag up online after reading the label ---------- */
import { lookupOnline } from "../dist/server/imports.js";

test("lookup: product page beats the search summary; empty stays empty; only fields with a source", async () => {
  const saved = { ...process.env };
  process.env.LLM_API_KEY = "k"; delete process.env.LLM_PROVIDER; delete process.env.LLM_BASE_URL; // anthropic default → search supported
  try {
    const search = async () => ({ found: true, url: "https://roaster.example/products/hillside", name: "Hillside", roaster: "Sample Roasters", origin: "Ethiopia (search)", processMethod: "Natural", roastLevel: "", tastingNotes: "blueberry", details: "", amountG: null, price: 25 });
    const fetchPage = async (url) => ({ found: true, source: "link", message: "", fields: ["origin", "price"], draft: { origin: "Ethiopia, Guji", price: 22, url } });
    const r = await lookupOnline({ name: "Hillside", roaster: "Sample Roasters" }, { search, fetchPage });
    assert.equal(r.found, true);
    assert.equal(r.url, "https://roaster.example/products/hillside");
    assert.equal(r.draft.origin, "Ethiopia, Guji"); assert.equal(r.sources.origin, "page");
    assert.equal(r.draft.price, 22); assert.equal(r.sources.price, "page");
    assert.equal(r.draft.tastingNotes, "blueberry"); assert.equal(r.sources.tastingNotes, "search");
    assert.ok(!("roastLevel" in r.draft) && !("amountG" in r.draft), "nothing invented for fields the page didn't state");

    const blocked = await lookupOnline({ name: "Hillside" }, { search, fetchPage: async () => { throw new Error("429"); } });
    assert.equal(blocked.draft.origin, "Ethiopia (search)", "a rate-limited page falls back to what search reported");

    const miss = await lookupOnline({ name: "Nope" }, { search: async () => ({ found: false, url: "", name: "", roaster: "", origin: "", processMethod: "", roastLevel: "", tastingNotes: "", details: "", amountG: null, price: null }), fetchPage });
    assert.equal(miss.found, false);
    assert.match(miss.message, /Couldn't find this coffee/);
    assert.match((await lookupOnline({}, { search, fetchPage })).message, /at least the coffee or roaster/);
  } finally {
    for (const k of ["LLM_API_KEY", "LLM_PROVIDER", "LLM_BASE_URL"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

test("lookup: without a search-capable provider it says so instead of guessing", async () => {
  const saved = process.env.LLM_API_KEY; delete process.env.LLM_API_KEY;
  try {
    const r = await lookupOnline({ name: "X" }, { search: async () => { throw new Error("should not be called"); }, fetchPage: async () => ({ found: false }) });
    assert.equal(r.found, false);
    assert.match(r.message, /needs an AI provider with web search/);
  } finally { if (saved !== undefined) process.env.LLM_API_KEY = saved; }
});
