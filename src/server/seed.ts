// Idempotent seed import: upsert by id. Safe to re-run.
import fs from "node:fs";
import path from "node:path";
import { type DB, nowIso, deriveStatus } from "./db.js";
import { loadCatalog, catalogGear, catalogRecipe, gearFromCatalog, renderTemplate, type OwnedGear } from "./catalog.js";

export const SEED_DIR = process.env.SEED_DIR || path.resolve("seed-data");

/** INSERT ... ON CONFLICT(id) DO UPDATE — never REPLACE (that would fire ON DELETE SET NULL on links). */
function upsert(db: DB, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const sql =
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")}) ` +
    `ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== "id").map((c) => `${c}=excluded.${c}`).join(",")}`;
  db.prepare(sql).run(row);
}

const j = (v: unknown) => (v == null ? null : JSON.stringify(v));
const b = (v: unknown) => (v == null ? null : v ? 1 : 0);

function readSeed<T>(file: string, dir = SEED_DIR): T | null {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

export interface SeedReport {
  gear: number;
  starterRecipes: number;
  recipes: number;
  brews: number;
  inventory: number;
  editions: number;
  picks: number;
  tastings: number;
  avoids: number;
}

/** Import a seed directory (default seed-data/; the demo uses demo/). Idempotent: upsert by id. */
export function runSeed(db: DB, dir = SEED_DIR): SeedReport {
  const t = nowIso();
  const report: SeedReport = { gear: 0, starterRecipes: 0, recipes: 0, brews: 0, inventory: 0, editions: 0, picks: 0, tastings: 0, avoids: 0 };
  // This instance's starting setup (seed-data/setup.json): library gear + recipe templates.
  // grindRanges: this install's own ranges for some gear, used instead of the library's
  // (e.g. ranges a spec requires); they're applied only when the gear is first installed.
  const setup = readSeed<{ gear?: string[]; recipes?: string[]; grindRanges?: Record<string, unknown> }>("setup.json", dir) ?? {};
  const cat = loadCatalog();
  if (cat.errors.length) throw new Error(`Gear library has errors:\n${cat.errors.join("\n")}`);

  db.transaction(() => {
    for (const id of setup.gear ?? []) {
      const c = catalogGear(id);
      if (!c) throw new Error(`setup.json lists gear "${id}", which isn't in the gear library`);
      const existing = db.prepare("SELECT createdAt, grindRanges FROM gear_items WHERE id=?").get(id) as { createdAt: string; grindRanges: string | null } | undefined;
      const row = gearFromCatalog(c);
      // Keep ranges the user has edited; otherwise take the library's.
      const own = setup.grindRanges?.[id];
      upsert(db, "gear_items", { ...row, grindRanges: existing?.grindRanges ?? (own ? JSON.stringify(own) : row.grindRanges), builtin: 0, createdAt: existing?.createdAt ?? t, updatedAt: t });
      report.gear++;
    }

    const owned = ownedGear(db);
    for (const rid of setup.recipes ?? []) {
      const tpl = catalogRecipe(rid);
      if (!tpl) throw new Error(`setup.json lists recipe "${rid}", which isn't in the recipe library`);
      if (tpl.legacyId == null) continue; // seeded starters need a stable id for idempotent upserts
      const r = renderTemplate(tpl, owned);
      const existing = db.prepare("SELECT createdAt FROM recipes WHERE id=?").get(tpl.legacyId) as { createdAt: string } | undefined;
      upsert(db, "recipes", {
        id: tpl.legacyId, name: r.name, brewerId: r.brewerId, brewerName: r.brewerName, method: r.method,
        coffee: null, doseG: r.doseG, waterG: r.waterG, tempC: r.tempC, grinderId: r.grinderId,
        grinderName: r.grinderName, grindSetting: r.grindSetting, steps: JSON.stringify(r.steps),
        notes: r.notes, favorite: 0, starter: 1, inventoryId: null, createdAt: existing?.createdAt ?? t, updatedAt: t,
      });
      report.starterRecipes++;
    }
  })();

  const gearRows = db.prepare("SELECT id, name, defaultMethod FROM gear_items").all() as { id: string; name: string; defaultMethod: string | null }[];
  const gearName = new Map(gearRows.map((g) => [g.id, g.name]));
  const brewerMethod = new Map(gearRows.map((g) => [g.id, g.defaultMethod]));

  db.transaction(() => {
    // Inventory first so recipe/brew links resolve.
    const inv = readSeed<{ items: any[] }>("assistant-inventory.json", dir);
    for (const i of inv?.items ?? []) {
      upsert(db, "inventory_items", {
        id: i.id, name: i.name, roaster: i.roaster ?? null, origin: i.origin ?? null, processMethod: i.processMethod ?? null,
        roastLevel: i.roastLevel ?? null, roastDate: i.roastDate ?? null, purchaseDate: i.purchaseDate ?? null,
        openedDate: i.openedDate ?? null, finishedDate: i.finishedDate ?? null, amountG: i.amountG ?? null,
        price: i.price ?? null, url: i.url ?? null, rating: i.rating ?? null, notes: i.notes ?? null,
        source: i.source ?? "manual", status: deriveStatus(i), createdAt: i.createdAt ?? t, updatedAt: i.updatedAt ?? t,
      });
      report.inventory++;
    }

    const rec = readSeed<{ recipes: any[] }>("assistant-recipes.json", dir);
    for (const r of rec?.recipes ?? []) {
      upsert(db, "recipes", {
        id: r.id, name: r.name, brewerId: r.brewerId ?? null, brewerName: gearName.get(r.brewerId) ?? r.brewerName ?? null,
        method: r.method ?? brewerMethod.get(r.brewerId) ?? null,
        coffee: r.coffee ?? null, doseG: r.doseG, waterG: r.waterG, tempC: r.tempC ?? null, grinderId: r.grinderId ?? null,
        grinderName: gearName.get(r.grinderId) ?? r.grinderName ?? null, grindSetting: r.grindSetting ?? null,
        steps: JSON.stringify(r.steps ?? []), notes: r.notes ?? null, favorite: r.favorite ? 1 : 0, starter: 0,
        inventoryId: r.inventoryId ?? null, createdAt: r.createdAt ?? t, updatedAt: r.updatedAt ?? t,
      });
      report.recipes++;
    }

    const br = readSeed<{ brews: any[] }>("assistant-brews.json", dir);
    for (const x of br?.brews ?? []) {
      upsert(db, "brews", {
        id: x.id, recipeId: x.recipeId ?? null, recipeName: x.recipeName ?? null, brewerId: x.brewerId ?? null,
        brewerName: gearName.get(x.brewerId) ?? x.brewerName ?? null, method: x.method ?? brewerMethod.get(x.brewerId) ?? null,
        coffee: x.coffee ?? null, doseG: x.doseG ?? null, waterG: x.waterG ?? null, tempC: x.tempC ?? null,
        grinderId: x.grinderId ?? null, grinderName: gearName.get(x.grinderId) ?? x.grinderName ?? null,
        grindSetting: x.grindSetting ?? null, steps: x.steps ? JSON.stringify(x.steps) : null,
        inventoryId: x.inventoryId ?? null, rating: x.rating ?? null, notes: x.notes ?? null,
        totalTimeSec: x.totalTimeSec ?? null, brewedAt: x.brewedAt ?? t,
      });
      report.brews++;
    }

    const board = readSeed<any>("recommendations-board.json", dir);
    if (board) {
      const editions = [board.latestEdition, ...(board.pastEditions ?? [])].filter(Boolean);
      for (const e of editions) {
        upsert(db, "board_editions", { id: e.id, weekLabel: e.weekLabel, seasonNote: e.seasonNote ?? null, createdAt: e.createdAt ?? t });
        report.editions++;
        for (const p of e.picks ?? []) {
          upsert(db, "picks", {
            id: p.id, editionId: e.id, rank: p.rank ?? null, kind: p.kind ?? "pick", name: p.name, roaster: p.roaster ?? null,
            origin: p.origin ?? null, processMethod: p.processMethod ?? null, tastingNotes: p.tastingNotes ?? null,
            roastLevel: p.roastLevel ?? null, priceAmount: p.priceAmount ?? null, priceText: p.priceText ?? null,
            url: p.url ?? null, whyFit: p.whyFit ?? null, brewTip: p.brewTip ?? null, funkRisk: p.funkRisk ?? null,
            status: p.status ?? "new", inventoryState: p.inventoryState ?? "not_added",
          });
          report.picks++;
        }
      }
      for (const x of board.tastings ?? []) {
        upsert(db, "tastings", {
          id: x.id, name: x.name, roaster: x.roaster ?? null, origin: x.origin ?? null, processMethod: x.processMethod ?? null,
          verdict: x.verdict, notes: x.notes ?? null, createdAt: x.createdAt ?? t,
        });
        report.tastings++;
      }
      for (const a of board.avoids ?? []) {
        upsert(db, "avoids", { id: a.id, name: a.name, roaster: a.roaster ?? null, reason: a.reason ?? null, url: a.url ?? null });
        report.avoids++;
      }
      if (board.refresh) {
        db.prepare("UPDATE refresh_state SET lastRunAt=?, lastStatus=?, lastNote=? WHERE id=1")
          .run(board.refresh.lastRunAt ?? null, board.refresh.lastStatus ?? null, board.refresh.lastNote ?? null);
      }
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('seededAt', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(t);
  })();
  return report;
}

/** Gear the instance owns, in the shape the recipe renderer needs. */
export function ownedGear(db: DB): OwnedGear[] {
  return (db.prepare("SELECT id, catalogId, name, type, category, units, grindRanges FROM gear_items").all() as any[]).map((g) => ({
    ...g,
    grindRanges: g.grindRanges ? JSON.parse(g.grindRanges) : null,
  }));
}

/**
 * One-time link for installs created before the gear library existed: gear that was built in
 * (builtin=1) is linked to its library entry, and grinders without saved ranges get the library's
 * ranges — the same values the old hardcoded chart supplied, so conversions don't change.
 */
export function linkGearToCatalog(db: DB) {
  const rows = db.prepare("SELECT id, grindRanges, catalogId FROM gear_items WHERE builtin=1").all() as { id: string; grindRanges: string | null; catalogId: string | null }[];
  let linked = 0;
  db.transaction(() => {
    for (const r of rows) {
      const c = catalogGear(r.id);
      if (!c) continue;
      const ranges = r.grindRanges ?? (c.grindRanges ? JSON.stringify(c.grindRanges) : null);
      db.prepare("UPDATE gear_items SET catalogId=?, catalogVersion=?, category=?, grindRanges=?, builtin=0 WHERE id=?")
        .run(c.id, c.version, c.category, ranges, r.id);
      linked++;
    }
  })();
  return linked;
}

export function seedIfNeeded(db: DB) {
  const done = db.prepare("SELECT value FROM meta WHERE key='seededAt'").get();
  if (done) return null;
  return runSeed(db);
}

export function counts(db: DB) {
  const c = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    userRecipes: c("SELECT COUNT(*) n FROM recipes WHERE starter=0"),
    starterRecipes: c("SELECT COUNT(*) n FROM recipes WHERE starter=1"),
    brews: c("SELECT COUNT(*) n FROM brews"),
    inventory: c("SELECT COUNT(*) n FROM inventory_items"),
    editions: c("SELECT COUNT(*) n FROM board_editions"),
    picks: c("SELECT COUNT(*) n FROM picks"),
    tastings: c("SELECT COUNT(*) n FROM tastings"),
    avoids: c("SELECT COUNT(*) n FROM avoids"),
    gear: c("SELECT COUNT(*) n FROM gear_items"),
  };
}
