import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR || "/data";
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "brewlab.db");
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- User preferences (units, default ratio, Discover on/off …), JSON values.
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS gear_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('grinder','brewer','other')),
  brand TEXT,
  details TEXT,
  units TEXT,
  burrs TEXT,
  espressoCapable INTEGER,
  variants TEXT,           -- JSON array
  grindRanges TEXT,        -- JSON (see src/shared/grind.ts GrindRanges)
  defaultMethod TEXT,      -- brewers: which grind-guide method they use by default
  builtin INTEGER NOT NULL DEFAULT 0,  -- legacy (pre-catalog); no longer used
  catalogId TEXT,          -- library entry this was installed from (catalog/gear/<id>.json)
  catalogVersion INTEGER,
  category TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  roaster TEXT,
  origin TEXT,
  processMethod TEXT,
  roastLevel TEXT,
  roastDate TEXT,
  purchaseDate TEXT,
  openedDate TEXT,
  finishedDate TEXT,
  amountG REAL,
  price REAL,
  url TEXT,
  rating INTEGER,
  notes TEXT,
  photo TEXT,              -- /uploads/<file> attached from the photo import
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'unopened',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS water_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  baseId TEXT,
  baseName TEXT,
  baseGh REAL,
  baseKh REAL,
  volume REAL NOT NULL,
  volumeUnit TEXT NOT NULL,
  additives TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  source TEXT,
  catalogId TEXT,
  catalogVersion INTEGER,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brewerId TEXT,
  brewerName TEXT,
  method TEXT,
  coffee TEXT,
  doseG REAL NOT NULL,
  waterG REAL NOT NULL,
  tempC REAL,
  grinderId TEXT,
  grinderName TEXT,
  grindSetting TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  starter INTEGER NOT NULL DEFAULT 0,
  inventoryId INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipeId INTEGER,
  recipeName TEXT,
  brewerId TEXT,
  brewerName TEXT,
  method TEXT,
  coffee TEXT,
  doseG REAL,
  waterG REAL,
  tempC REAL,
  grinderId TEXT,
  grinderName TEXT,
  grindSetting TEXT,
  steps TEXT,
  inventoryId INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  rating INTEGER,
  notes TEXT,
  totalTimeSec INTEGER,
  brewedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekLabel TEXT NOT NULL,
  seasonNote TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  editionId INTEGER NOT NULL REFERENCES board_editions(id) ON DELETE CASCADE,
  rank INTEGER,
  kind TEXT NOT NULL DEFAULT 'pick',
  name TEXT NOT NULL,
  roaster TEXT,
  origin TEXT,
  processMethod TEXT,
  tastingNotes TEXT,
  roastLevel TEXT,
  priceAmount REAL,
  priceText TEXT,
  url TEXT,
  whyFit TEXT,
  brewTip TEXT,
  funkRisk TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  inventoryState TEXT NOT NULL DEFAULT 'not_added'
);

CREATE TABLE IF NOT EXISTS tastings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  roaster TEXT,
  origin TEXT,
  processMethod TEXT,
  verdict TEXT NOT NULL,
  notes TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS avoids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  roaster TEXT,
  reason TEXT,
  url TEXT
);

CREATE TABLE IF NOT EXISTS refresh_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lastRunAt TEXT,
  lastStatus TEXT,
  lastNote TEXT
);

-- Manual research step: candidates entered by the user (or an external pass)
-- waiting for the next refresh to apply the matching rules and publish.
CREATE TABLE IF NOT EXISTS refresh_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`;

export function openDb(file = DB_PATH): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  db.prepare("INSERT OR IGNORE INTO refresh_state (id, lastStatus, lastNote) VALUES (1, 'never', '')").run();
  return db;
}

/** Additive migrations for databases created by earlier versions. */
function migrate(db: DB) {
  const has = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  if (!has("inventory_items", "photo")) db.exec("ALTER TABLE inventory_items ADD COLUMN photo TEXT");
  if (!has("gear_items", "catalogId")) db.exec("ALTER TABLE gear_items ADD COLUMN catalogId TEXT");
  if (!has("gear_items", "catalogVersion")) db.exec("ALTER TABLE gear_items ADD COLUMN catalogVersion INTEGER");
  if (!has("gear_items", "category")) db.exec("ALTER TABLE gear_items ADD COLUMN category TEXT");
  if (!has("gear_items", "rangeInfo")) db.exec("ALTER TABLE gear_items ADD COLUMN rangeInfo TEXT"); // JSON: where the ranges come from
  // Water recipes: a recipe's default water and the water a brew used (name kept if the water is deleted).
  if (!has("water_recipes", "concentrate")) db.exec("ALTER TABLE water_recipes ADD COLUMN concentrate INTEGER NOT NULL DEFAULT 0");
  for (const t of ["recipes", "brews"]) {
    if (!has(t, "waterId")) db.exec(`ALTER TABLE ${t} ADD COLUMN waterId INTEGER REFERENCES water_recipes(id) ON DELETE SET NULL`);
    if (!has(t, "waterName")) db.exec(`ALTER TABLE ${t} ADD COLUMN waterName TEXT`);
  }
}

export const nowIso = () => new Date().toISOString();

/** Today's date (YYYY-MM-DD) in the container's local time zone (TZ). */
export function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function deriveStatus(i: { openedDate?: string | null; finishedDate?: string | null }) {
  if (i.finishedDate) return "finished";
  if (i.openedDate) return "open";
  return "unopened";
}
