// Water recipes (More → Water): your own, or copies from the library (catalog/water/). Recipes can
// name a default water and brews record the water they used; deleting a water keeps its name on them.
import express, { type Response } from "express";
import { type DB, nowIso } from "./db.js";
import { WaterSchema, firstError } from "./schemas.js";
import { loadWaterCatalog, catalogWater, waterFromTemplate } from "./catalog.js";
import { hardness, CONCENTRATE_UNITS, type ConcentrateMap, type WaterLine, type WaterMix } from "../shared/water.js";
import type { z } from "zod";

const bad = (res: Response, msg: string, code = 400) => res.status(code).json({ error: msg });
const parseLines = (v: unknown): WaterLine[] => {
  try {
    const x = JSON.parse(String(v ?? "[]"));
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
};

/** Your concentrates' own strength. They can't contain concentrates, so one pass is enough. */
export function concentrateMap(db: DB): ConcentrateMap {
  const cat = loadWaterCatalog();
  const m: ConcentrateMap = new Map();
  for (const c of db.prepare("SELECT * FROM water_recipes WHERE concentrate=1").all() as any[]) {
    const h = hardness({ ...c, additives: parseLines(c.additives) }, cat);
    m.set(c.id, { name: c.name, gh: h.gh, kh: h.kh });
  }
  return m;
}

export function waterRow(db: DB, r: any, conc: ConcentrateMap = concentrateMap(db)) {
  // A concentrate's line shows its current name.
  const additives = parseLines(r.additives).map((l) => (l.concentrateId != null && conc.get(l.concentrateId) ? { ...l, name: conc.get(l.concentrateId)!.name } : l));
  const mix: WaterMix = { ...r, additives };
  const use = db.prepare("SELECT COUNT(*) n, AVG(rating) avg, COUNT(rating) rated FROM brews WHERE waterId=?").get(r.id) as { n: number; avg: number | null; rated: number };
  const recipes = (db.prepare("SELECT COUNT(*) n FROM recipes WHERE waterId=?").get(r.id) as { n: number }).n;
  return {
    ...r, concentrate: Boolean(r.concentrate), additives, hardness: hardness(mix, loadWaterCatalog(), conc),
    usage: { recipes, brews: use.n, rated: use.rated, avgRating: use.avg == null ? null : Math.round(use.avg * 10) / 10 },
  };
}

/** Name for a linked water (recipes and brews keep it if the water is deleted later). */
export function waterNameFor(db: DB, waterId: number | null | undefined, fallback: string | null | undefined) {
  if (waterId == null) return fallback ?? null;
  const w = db.prepare("SELECT name, concentrate FROM water_recipes WHERE id=?").get(waterId) as { name: string; concentrate: number } | undefined;
  if (!w) throw new Error("That water recipe no longer exists.");
  if (w.concentrate) throw new Error(`${w.name} is a concentrate: brew with a water made from it.`);
  return w.name;
}

export function waterRouter(db: DB) {
  const r = express.Router();
  const get = (id: number | bigint) => waterRow(db, db.prepare("SELECT * FROM water_recipes WHERE id=?").get(id));

  /** Bases, additives and library recipes (with whether you already have a copy). */
  r.get("/water/catalog", (_req, res) => {
    const c = loadWaterCatalog();
    const owned = new Set((db.prepare("SELECT catalogId FROM water_recipes WHERE catalogId IS NOT NULL").all() as any[]).map((x) => x.catalogId));
    res.json({
      bases: c.bases, additives: c.additives, errors: c.errors,
      recipes: c.recipes.map((t) => {
        const w = waterFromTemplate(t);
        return { ...t, owned: owned.has(t.id), baseName: w.baseName, lines: w.additives, hardness: hardness(w, c) };
      }),
    });
  });

  r.get("/water", (_req, res) => {
    const conc = concentrateMap(db);
    res.json((db.prepare("SELECT * FROM water_recipes ORDER BY concentrate, name COLLATE NOCASE").all() as any[]).map((x) => waterRow(db, x, conc)));
  });

  /** Water recipes that add this concentrate. */
  const usersOf = (id: number) =>
    (db.prepare("SELECT id, name, additives FROM water_recipes WHERE id<>?").all(id) as any[]).filter((w) => parseLines(w.additives).some((l) => l.concentrateId === id)).map((w) => w.name as string);

  const values = (d: z.infer<typeof WaterSchema>, selfId?: number) => {
    const c = loadWaterCatalog();
    const base = d.baseId ? c.bases.find((b) => b.id === d.baseId) : undefined;
    if (d.baseId && !base) throw new Error(`Unknown base water "${d.baseId}"`);
    const additives = d.additives.map((l) => {
      if (l.concentrateId != null) {
        if (d.concentrate) throw new Error("A concentrate can't contain another concentrate.");
        const cc = db.prepare("SELECT id, name, concentrate FROM water_recipes WHERE id=?").get(l.concentrateId) as any;
        if (!cc || cc.id === selfId || !cc.concentrate) throw new Error(`"${l.name}" isn't one of your concentrates.`);
        if (!CONCENTRATE_UNITS.includes(l.unit)) throw new Error(`Measure ${cc.name} in g, mg or ml.`);
        return { concentrateId: cc.id, name: cc.name, amount: l.amount, unit: l.unit };
      }
      if (!l.additiveId) return { additiveId: null, name: l.name.trim(), amount: l.amount, unit: l.unit, gh: l.gh ?? null, kh: l.kh ?? null };
      const a = c.additives.find((x) => x.id === l.additiveId);
      if (!a) throw new Error(`Unknown additive "${l.additiveId}"`);
      return { additiveId: a.id, name: a.name, amount: l.amount, unit: l.unit }; // strength comes from the library
    });
    return {
      name: d.name.trim(), baseId: base?.id ?? null, baseName: base?.name ?? (d.baseName?.trim() || null),
      baseGh: d.baseGh ?? null, baseKh: d.baseKh ?? null, volume: d.volume, volumeUnit: d.volumeUnit,
      additives: JSON.stringify(additives), notes: d.notes?.trim() || null, source: d.source?.trim() || null,
      concentrate: d.concentrate ? 1 : 0,
    };
  };

  r.post("/water", (req, res) => {
    const p = WaterSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    try {
      const v = values(p.data);
      const t = nowIso();
      const info = db.prepare(
        `INSERT INTO water_recipes (name, baseId, baseName, baseGh, baseKh, volume, volumeUnit, additives, notes, source, concentrate, createdAt, updatedAt)
         VALUES (@name, @baseId, @baseName, @baseGh, @baseKh, @volume, @volumeUnit, @additives, @notes, @source, @concentrate, @t, @t)`,
      ).run({ ...v, t });
      res.json(get(info.lastInsertRowid));
    } catch (e: any) {
      bad(res, e.message);
    }
  });

  r.put("/water/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM water_recipes WHERE id=?").get(id)) return bad(res, "Water recipe not found", 404);
    const p = WaterSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    try {
      const v = values(p.data, id);
      const users = usersOf(id);
      if (!v.concentrate && users.length) return bad(res, `It's still a concentrate in ${users.join(", ")}: take it out there first.`, 409);
      const brewedWith = (db.prepare("SELECT (SELECT COUNT(*) FROM recipes WHERE waterId=?) + (SELECT COUNT(*) FROM brews WHERE waterId=?) n").get(id, id) as { n: number }).n;
      if (v.concentrate && brewedWith) return bad(res, "Recipes or brews use this as their brewing water, so it can't become a concentrate. Make a new water for the concentrate instead.", 409);
      db.transaction(() => {
        db.prepare(
          `UPDATE water_recipes SET name=@name, baseId=@baseId, baseName=@baseName, baseGh=@baseGh, baseKh=@baseKh, volume=@volume,
           volumeUnit=@volumeUnit, additives=@additives, notes=@notes, source=@source, concentrate=@concentrate, updatedAt=@t WHERE id=@id`,
        ).run({ ...v, id, t: nowIso() });
        // Linked recipes and brews show the current name.
        for (const t of ["recipes", "brews"]) db.prepare(`UPDATE ${t} SET waterName=? WHERE waterId=?`).run(v.name, id);
      })();
      res.json(get(id));
    } catch (e: any) {
      bad(res, e.message);
    }
  });

  r.delete("/water/:id", (req, res) => {
    const id = Number(req.params.id);
    const w = db.prepare("SELECT * FROM water_recipes WHERE id=?").get(id) as any;
    if (!w) return bad(res, "Water recipe not found", 404);
    const users = usersOf(id);
    if (users.length) return bad(res, `${w.name} is a concentrate in ${users.join(", ")}: take it out there first.`, 409);
    db.transaction(() => {
      // Recipes and brews keep the water's name and lose the link.
      for (const t of ["recipes", "brews"]) db.prepare(`UPDATE ${t} SET waterName=COALESCE(waterName, ?), waterId=NULL WHERE waterId=?`).run(w.name, id);
      db.prepare("DELETE FROM water_recipes WHERE id=?").run(id);
    })();
    res.json({ ok: true });
  });

  /** Add a library water recipe as your own editable copy. */
  r.post("/water/from-catalog", (req, res) => {
    const t = catalogWater(String(req.body?.catalogId ?? ""));
    if (!t) return bad(res, "That water recipe isn't in the library.", 404);
    const w = waterFromTemplate(t);
    let name = w.name;
    for (let n = 2; db.prepare("SELECT 1 FROM water_recipes WHERE lower(name)=lower(?)").get(name); n++) name = `${w.name} (${n})`;
    const now = nowIso();
    const info = db.prepare(
      `INSERT INTO water_recipes (name, baseId, baseName, baseGh, baseKh, volume, volumeUnit, additives, notes, source, catalogId, catalogVersion, createdAt, updatedAt)
       VALUES (@name, @baseId, @baseName, @baseGh, @baseKh, @volume, @volumeUnit, @additives, @notes, @source, @catalogId, @catalogVersion, @t, @t)`,
    ).run({ ...w, name, additives: JSON.stringify(w.additives), t: now });
    res.json(get(info.lastInsertRowid));
  });

  return r;
}
