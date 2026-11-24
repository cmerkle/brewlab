// Backups: consistent SQLite snapshots (online backup API, safe while the app runs)
// into /data/backups with rotation, plus a full JSON export of every table.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { type DB, DATA_DIR, nowIso } from "./db.js";
import { getSettings, setSettings } from "./settings.js";

export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, "backups");
export const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
const NAME_RE = /^brewlab-\d{4}-\d{2}-\d{2}(?:_\d{6})?\.db$/;

function stamp(withTime: boolean) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${day}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` : day;
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, bytes: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** How many snapshots to keep: the user's setting (More → Settings → Backups), else BACKUP_KEEP. */
export const keepFor = (db: DB) => getSettings(db).backupKeep ?? BACKUP_KEEP;

/** Delete all but the newest `keep` snapshots; returns the names removed. */
export function pruneBackups(keep: number) {
  const old = listBackups().slice(keep).map((b) => b.name);
  for (const name of old) fs.rmSync(path.join(BACKUP_DIR, name), { force: true });
  return old;
}

/** Snapshot the database; nightly runs use one file per day, manual ones are timestamped. */
export async function createBackup(db: DB, kind: "nightly" | "manual") {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `brewlab-${stamp(kind === "manual")}.db`;
  const file = path.join(BACKUP_DIR, name);
  const tmp = `${file}.partial`;
  await db.backup(tmp);
  fs.renameSync(tmp, file);
  pruneBackups(keepFor(db));
  return { name, bytes: fs.statSync(file).size };
}

const TABLES = ["gear_items", "water_recipes", "recipes", "brews", "inventory_items", "board_editions", "picks", "tastings", "avoids", "refresh_state", "refresh_candidates"];

export function exportAll(db: DB) {
  const out: Record<string, unknown> = { app: "brewlab", exportedAt: nowIso() };
  for (const t of TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return out;
}

export function backupRouter(db: DB) {
  const r = express.Router();
  const state = () => ({ dir: BACKUP_DIR, keep: keepFor(db), keepDefault: BACKUP_KEEP, custom: getSettings(db).backupKeep != null, backups: listBackups() });
  r.get("/backups", (_req, res) => res.json(state()));
  // Retention: { keep: number } or { keep: null } for the BACKUP_KEEP default. Applies right away.
  r.put("/backups/retention", (req, res) => {
    const keep = req.body?.keep;
    if (keep !== null && !(Number.isInteger(keep) && keep >= 1 && keep <= 365)) return res.status(400).json({ error: "Keep between 1 and 365 backups" });
    setSettings(db, { backupKeep: keep });
    const removed = pruneBackups(keepFor(db));
    res.json({ ...state(), removed });
  });
  r.post("/backups", async (_req, res) => {
    try {
      res.json(await createBackup(db, "manual"));
    } catch (e: any) {
      res.status(500).json({ error: `Backup failed: ${e.message}` });
    }
  });
  r.get("/backups/:name", (req, res) => {
    const name = req.params.name;
    if (!NAME_RE.test(name) || !fs.existsSync(path.join(BACKUP_DIR, name))) return res.status(404).json({ error: "Backup not found" });
    res.download(path.join(BACKUP_DIR, name), name);
  });
  r.delete("/backups/:name", (req, res) => {
    const name = req.params.name;
    if (!NAME_RE.test(name) || !fs.existsSync(path.join(BACKUP_DIR, name))) return res.status(404).json({ error: "Backup not found" });
    fs.rmSync(path.join(BACKUP_DIR, name));
    res.json(state());
  });
  r.get("/export", (_req, res) => {
    res.setHeader("Content-Disposition", `attachment; filename="brewlab-export-${stamp(false)}.json"`);
    res.json(exportAll(db));
  });
  return r;
}
