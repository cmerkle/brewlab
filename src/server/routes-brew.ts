import express, { type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { type DB, nowIso, todayLocal, deriveStatus, UPLOAD_DIR } from "./db.js";
import { RecipeSchema, BrewSchema, InventorySchema, GearSchema, RecommendationSchema, TastingSchema, LIMITS, firstError } from "./schemas.js";
import { validateRanges, METHODS, toGrindNumber, CATEGORY_METHOD, type Method } from "../shared/grind.js";
import { loadCatalog, catalogGear, gearFromCatalog, libraryEntryFor, rangeInfoFromCatalog, loadEstimateRules } from "./catalog.js";
import { importFromLink, importFromPhoto, lookupOnline } from "./imports.js";
import { sameCoffee } from "./rules.js";
import { waterNameFor } from "./routes-water.js";
import { normalizeRoastLevel, parseTags, cleanTags } from "./bags.js";
import { splitTags } from "../shared/stash.js";
import { loadVocab } from "./catalog.js";
import type { z } from "zod";

const j = (v: unknown) => (v == null ? null : JSON.stringify(v));
const parseJ = (v: unknown) => {
  if (v == null || v === "") return null;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
};

/** Saved source info: trimmed, estimated methods limited to ones that still have a range. */
function cleanRangeInfo(i: z.infer<typeof GearSchema>["rangeInfo"], ranges: { methods?: Record<string, unknown> } | null) {
  if (!i) return null;
  const out = {
    confidence: i.confidence ?? null,
    source: i.source?.trim() || null,
    note: i.note?.trim() || null,
    estimated: (i.estimated ?? []).filter((m) => ranges?.methods?.[m]),
    estimateNote: i.estimateNote?.trim() || null,
  };
  return out.source || out.note || out.estimated.length || out.confidence ? out : null;
}

export function gearRow(r: any) {
  return {
    ...r,
    espressoCapable: undefined, // retired column; "can do" lives in grindRanges.unsupported
    variants: parseJ(r.variants),
    grindRanges: parseJ(r.grindRanges),
    rangeInfo: parseJ(r.rangeInfo) ?? null,
    builtin: Boolean(r.builtin),
    library: libraryInfo(r),
  };
}

/** Where a gear item came from in the library, and whether the library's ranges now differ. */
function libraryInfo(r: any) {
  if (!r.catalogId) return null;
  const c = catalogGear(r.catalogId);
  if (!c) return { id: r.catalogId, missing: true };
  const libRanges = c.grindRanges ? JSON.stringify(c.grindRanges) : null;
  return {
    id: c.id,
    name: c.name,
    installedVersion: r.catalogVersion ?? null,
    latestVersion: c.version,
    confidence: c.rangeInfo?.confidence ?? null,
    source: c.rangeInfo?.source ?? null,
    note: c.rangeInfo?.note ?? null,
    hasRanges: Boolean(c.grindRanges),
    rangesDiffer: Boolean(libRanges) && normalizeJson(libRanges) !== normalizeJson(r.grindRanges),
  };
}
/** Key order and empty (null) fields don't count as a difference. */
const normalizeJson = (s: string | null) => {
  if (!s) return "";
  try {
    const sort = (v: any): any => (Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => v[k] != null).sort().map((k) => [k, sort(v[k])])) : v);
    return JSON.stringify(sort(JSON.parse(s)));
  } catch {
    return s;
  }
};

/** Stored in a TEXT column (older databases), returned as a number. */
const grindNum = (x: unknown) => toGrindNumber(x);

export function recipeRow(r: any) {
  return { ...r, grindSetting: grindNum(r.grindSetting), steps: parseJ(r.steps) ?? [], favorite: Boolean(r.favorite), starter: Boolean(r.starter) };
}

export function brewRow(r: any) {
  return { ...r, grindSetting: grindNum(r.grindSetting), steps: parseJ(r.steps) };
}

export function inventoryRow(db: DB, r: any) {
  const used = (db.prepare("SELECT COALESCE(SUM(doseG),0) s FROM brews WHERE inventoryId=?").get(r.id) as { s: number }).s;
  return {
    ...r,
    tastingNotes: parseTags(r.tastingNotes),
    status: deriveStatus(r),
    usedG: used,
    unloggedG: r.unloggedG ?? 0,
    remainingG: r.amountG == null ? null : Math.round((r.amountG - used - (r.unloggedG ?? 0)) * 10) / 10,
  };
}

/* ------------------------------ uploads ------------------------------ */

/** Delete an uploaded photo file unless another bag still references it. */
export function removeUpload(db: DB, photo: string) {
  const still = db.prepare("SELECT 1 FROM inventory_items WHERE photo=?").get(photo);
  if (still) return;
  const file = path.join(UPLOAD_DIR, path.basename(photo));
  fs.rm(file, { force: true }, () => {});
}

/** Remove uploads no bag references (e.g. a photo import that was never saved), older than a day. */
export function sweepUploads(db: DB, maxAgeMs = 24 * 3600 * 1000) {
  if (!fs.existsSync(UPLOAD_DIR)) return 0;
  const used = new Set((db.prepare("SELECT photo FROM inventory_items WHERE photo IS NOT NULL").all() as { photo: string }[]).map((r) => path.basename(r.photo)));
  let n = 0;
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    if (!f.startsWith("bag-") || used.has(f)) continue;
    const full = path.join(UPLOAD_DIR, f);
    if (Date.now() - fs.statSync(full).mtimeMs > maxAgeMs) {
      fs.rmSync(full, { force: true });
      n++;
    }
  }
  return n;
}

/* ------------------------------ addToInventory ------------------------------ */

export type Recommendation = z.infer<typeof RecommendationSchema>;

/** Plain function call shared by the endpoint and the Discover section. */
export function addToInventory(db: DB, rec: Recommendation): { added: boolean; item: any } {
  const open = db.prepare("SELECT * FROM inventory_items WHERE finishedDate IS NULL").all() as any[];
  const existing = open.find((i) => sameCoffee({ name: rec.name, roaster: rec.roaster }, i));
  if (existing) return { added: false, item: inventoryRow(db, existing) };
  const notesParts = [];
  if (rec.priceText) notesParts.push(`Listed at ${rec.priceText}`);
  const t = nowIso();
  const info = db
    .prepare(
      `INSERT INTO inventory_items (name, roaster, origin, processMethod, roastLevel, purchaseDate, amountG, price, url, notes, tastingNotes, source, status, createdAt, updatedAt)
       VALUES (@name, @roaster, @origin, @processMethod, @roastLevel, @purchaseDate, NULL, @price, @url, @notes, @tags, 'Coffee Recommendations', 'unopened', @t, @t)`,
    )
    .run({
      name: rec.name, roaster: rec.roaster ?? null, origin: rec.origin ?? null, processMethod: rec.processMethod ?? null,
      roastLevel: normalizeRoastLevel(rec.roastLevel), purchaseDate: todayLocal(), tags: JSON.stringify(splitTags(rec.tastingNotes)), price: rec.priceAmount ?? null, url: rec.url || null,
      notes: notesParts.join(" · ") || null, t,
    });
  const item = db.prepare("SELECT * FROM inventory_items WHERE id=?").get(info.lastInsertRowid);
  return { added: true, item: inventoryRow(db, item) };
}

/** Identity of a recipe's content (used for duplicate detection). */
function recipeKey(r: any) {
  const steps = typeof r.steps === "string" ? r.steps : JSON.stringify(r.steps ?? []);
  return JSON.stringify([
    (r.name ?? "").trim().toLowerCase(), r.brewerId ?? null, r.method ?? null, r.coffee ?? null, Number(r.doseG), Number(r.waterG),
    r.tempC == null ? null : Number(r.tempC), r.grinderId ?? null, r.grindSetting ?? null, JSON.parse(steps || "[]"),
    r.notes ?? null, r.inventoryId ?? null, r.waterId ?? null, r.roastLevel ?? null,
  ]);
}

/** "If duplicates appear, keep one of each distinct recipe." Runs at startup. */
export function dedupeRecipes(db: DB) {
  const rows = db.prepare("SELECT * FROM recipes ORDER BY id").all() as any[];
  const seen = new Map<string, number>();
  let removed = 0;
  db.transaction(() => {
    for (const r of rows) {
      const k = recipeKey(r);
      const keep = seen.get(k);
      if (keep == null) {
        seen.set(k, r.id);
        continue;
      }
      db.prepare("UPDATE brews SET recipeId=? WHERE recipeId=?").run(keep, r.id);
      db.prepare("DELETE FROM recipes WHERE id=?").run(r.id);
      removed++;
    }
  })();
  return removed;
}

export function brewRouter(db: DB) {
  const r = express.Router();
  const bad = (res: Response, msg: string, code = 400) => res.status(code).json({ error: msg });

  const gearNames = () => new Map((db.prepare("SELECT id, name FROM gear_items").all() as any[]).map((g) => [g.id, g.name]));

  /* ---------- schema ---------- */
  r.get("/schema", (_req, res) => res.json({ limits: LIMITS, methods: METHODS }));
  /** Words for bags: roast levels (with rest windows), processes, origins, tasting-note suggestions. */
  r.get("/vocab", (_req, res) => res.json(loadVocab().vocab));

  /* ---------- gear ---------- */
  r.get("/gear", (_req, res) => {
    res.json((db.prepare("SELECT * FROM gear_items ORDER BY type, name").all() as any[]).map(gearRow));
  });

  const saveGear = (req: Request, res: Response, id?: string) => {
    const p = GearSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    const g = p.data;
    let ranges = g.grindRanges ?? null;
    if (g.type === "grinder" && ranges) {
      const err = validateRanges(ranges.methods ?? {});
      if (err) return bad(res, err);
      // Drop empty method entries.
      const methods: Record<string, { low: number; high: number }> = {};
      // Methods it can't do have no range; an older client's "not espresso-capable" means the same.
      const unsupported = new Set(ranges.unsupported ?? []);
      if (g.espressoCapable === false && !ranges.methods?.espresso) unsupported.add("espresso");
      for (const [m, v] of Object.entries(ranges.methods ?? {}))
        if (v && v.low != null && v.high != null && !unsupported.has(m as Method)) methods[m] = { low: v.low, high: v.high };
      ranges = { ...ranges, methods, unsupported: METHODS.filter((m) => unsupported.has(m)) };
      if (!ranges.unsupported!.length) delete ranges.unsupported;
      if (!Object.keys(methods).length && !ranges.unsupported) ranges = null;
    } else if (g.type === "grinder" && g.espressoCapable === false) {
      ranges = { methods: {}, unsupported: ["espresso"] };
    }
    if (g.type !== "grinder") ranges = null;
    const t = nowIso();
    const row = {
      name: g.name, type: g.type, brand: g.brand ?? null, details: g.details ?? null, units: g.units ?? null, burrs: g.burrs ?? null,
      espressoCapable: null, variants: j(g.variants ?? null),
      grindRanges: j(ranges),
      defaultMethod: g.type === "brewer" ? g.defaultMethod ?? (g.category ? CATEGORY_METHOD[g.category] : null) ?? null : null,
      category: g.category ?? null, updatedAt: t,
      rangeInfo: g.type === "grinder" && g.rangeInfo !== undefined ? j(cleanRangeInfo(g.rangeInfo, ranges)) : undefined,
    };
    if (id) {
      const ex = db.prepare("SELECT id FROM gear_items WHERE id=?").get(id);
      if (!ex) return bad(res, "Gear not found", 404);
      db.prepare(
        `UPDATE gear_items SET name=@name, type=@type, brand=@brand, details=@details, units=@units, burrs=@burrs, espressoCapable=@espressoCapable,
         variants=@variants, grindRanges=@grindRanges, defaultMethod=@defaultMethod, category=COALESCE(@category, category), updatedAt=@updatedAt,
         rangeInfo=CASE WHEN @keepInfo THEN rangeInfo ELSE @rangeInfo END WHERE id=@id`,
      ).run({ ...row, rangeInfo: row.rangeInfo ?? null, keepInfo: row.rangeInfo === undefined && g.type === "grinder" ? 1 : 0, id });
      // Keep recorded names in sync while the link exists.
      db.prepare("UPDATE recipes SET brewerName=? WHERE brewerId=?").run(g.name, id);
      db.prepare("UPDATE recipes SET grinderName=? WHERE grinderId=?").run(g.name, id);
    } else {
      const base = g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gear";
      let newId = base, n = 2;
      while (db.prepare("SELECT 1 FROM gear_items WHERE id=?").get(newId)) newId = `${base}-${n++}`;
      id = newId;
      db.prepare(
        `INSERT INTO gear_items (id, name, type, brand, details, units, burrs, espressoCapable, variants, grindRanges, rangeInfo, defaultMethod, category, builtin, createdAt, updatedAt)
         VALUES (@id, @name, @type, @brand, @details, @units, @burrs, @espressoCapable, @variants, @grindRanges, @rangeInfo, @defaultMethod, @category, 0, @createdAt, @updatedAt)`,
      ).run({ ...row, rangeInfo: row.rangeInfo ?? null, id, createdAt: t });
    }
    res.json(gearRow(db.prepare("SELECT * FROM gear_items WHERE id=?").get(id)));
  };
  /* ---------- gear & recipe library (catalog/) ---------- */
  /** The rules behind "Estimate the empty rows" (catalog/estimate-rules.json). */
  r.get("/catalog/estimate-rules", (_req, res) => {
    const er = loadEstimateRules();
    if (!er.rules) return bad(res, `The estimate rules couldn't be read: ${er.error}`, 500);
    res.json(er.rules);
  });
  r.get("/catalog", (_req, res) => {
    const c = loadCatalog();
    const owned = new Set((db.prepare("SELECT catalogId FROM gear_items WHERE catalogId IS NOT NULL").all() as any[]).map((x) => x.catalogId));
    res.json({
      gear: c.gear.map((g) => ({
        id: g.id, name: g.name, brand: g.brand, type: g.type, category: g.category, units: g.units ?? null,
        variants: g.variants ?? null, defaultMethod: g.defaultMethod ?? null,
        hasRanges: Boolean(g.grindRanges), methods: g.grindRanges ? Object.keys(g.grindRanges.methods) : [],
        confidence: g.rangeInfo?.confidence ?? null, owned: owned.has(g.id),
      })),
      recipes: c.recipes.map((t) => ({ id: t.id, name: t.name, method: t.method, credit: t.credit ?? null, brewer: t.brewer })),
      errors: c.errors,
    });
  });
  /** Install a library model as the user's own editable gear item. */
  r.post("/gear/from-catalog", (req, res) => {
    const c = catalogGear(String(req.body?.catalogId ?? ""));
    if (!c) return bad(res, "That gear isn't in the library.", 404);
    const row = gearFromCatalog(c);
    let id = row.id, n = 2;
    while (db.prepare("SELECT 1 FROM gear_items WHERE id=?").get(id)) id = `${row.id}-${n++}`;
    const t = nowIso();
    db.prepare(
      `INSERT INTO gear_items (id, name, type, brand, details, units, burrs, espressoCapable, variants, grindRanges, rangeInfo, defaultMethod, builtin, catalogId, catalogVersion, category, createdAt, updatedAt)
       VALUES (@id, @name, @type, @brand, @details, @units, @burrs, @espressoCapable, @variants, @grindRanges, @rangeInfo, @defaultMethod, 0, @catalogId, @catalogVersion, @category, @t, @t)`,
    ).run({ ...row, id, name: id === row.id ? row.name : `${row.name} (${n - 1})`, t });
    res.json(gearRow(db.prepare("SELECT * FROM gear_items WHERE id=?").get(id)));
  });
  /** "Suggest to the library": a ready-to-submit catalog entry for this gear (nothing is sent anywhere). */
  r.post("/gear/:id/library-entry", (req, res) => {
    const row = db.prepare("SELECT * FROM gear_items WHERE id=?").get(req.params.id) as any;
    if (!row) return bad(res, "Gear not found", 404);
    const g = gearRow(row);
    const b = req.body ?? {};
    res.json(libraryEntryFor(g as any, { confidence: typeof b.confidence === "string" ? b.confidence : undefined, source: typeof b.source === "string" ? b.source : undefined, note: typeof b.note === "string" ? b.note.slice(0, 1000) : undefined }));
  });
  /** Replace a grinder's ranges with the library's current ones (offered, never automatic). */
  r.post("/gear/:id/reset-ranges", (req, res) => {
    const g = db.prepare("SELECT * FROM gear_items WHERE id=?").get(req.params.id) as any;
    if (!g) return bad(res, "Gear not found", 404);
    const c = g.catalogId ? catalogGear(g.catalogId) : null;
    if (!c?.grindRanges) return bad(res, "The library has no ranges for this gear.");
    const info = rangeInfoFromCatalog(c);
    db.prepare("UPDATE gear_items SET grindRanges=?, rangeInfo=?, catalogVersion=?, updatedAt=? WHERE id=?").run(JSON.stringify(c.grindRanges), info ? JSON.stringify(info) : null, c.version, nowIso(), g.id);
    res.json(gearRow(db.prepare("SELECT * FROM gear_items WHERE id=?").get(g.id)));
  });

  r.post("/gear", (req, res) => saveGear(req, res));
  r.put("/gear/:id", (req, res) => saveGear(req, res, req.params.id));
  r.delete("/gear/:id", (req, res) => {
    const id = req.params.id;
    const g = db.prepare("SELECT * FROM gear_items WHERE id=?").get(id) as any;
    if (!g) return bad(res, "Gear not found", 404);
    db.transaction(() => {
      // Recipes and brews keep their recorded names and lose the link (gear amendment).
      for (const t of ["recipes", "brews"]) {
        db.prepare(`UPDATE ${t} SET brewerName=COALESCE(brewerName, ?), brewerId=NULL WHERE brewerId=?`).run(g.name, id);
        db.prepare(`UPDATE ${t} SET grinderName=COALESCE(grinderName, ?), grinderId=NULL WHERE grinderId=?`).run(g.name, id);
      }
      db.prepare("DELETE FROM gear_items WHERE id=?").run(id);
    })();
    res.json({ ok: true });
  });

  /* ---------- recipes ---------- */
  r.get("/recipes", (_req, res) => {
    res.json((db.prepare("SELECT * FROM recipes ORDER BY starter DESC, name").all() as any[]).map(recipeRow));
  });
  r.get("/recipes/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM recipes WHERE id=?").get(req.params.id);
    if (!row) return bad(res, "Recipe not found", 404);
    res.json(recipeRow(row));
  });

  const recipeValues = (d: z.infer<typeof RecipeSchema>) => {
    const names = gearNames();
    let coffee = d.coffee ?? null;
    if (d.inventoryId != null) {
      const bag = db.prepare("SELECT name FROM inventory_items WHERE id=?").get(d.inventoryId) as any;
      if (!bag) throw new Error("That inventory bag no longer exists.");
      coffee = coffee || bag.name;
    }
    return {
      name: d.name.trim(), brewerId: d.brewerId || null, brewerName: (d.brewerId && names.get(d.brewerId)) || d.brewerName || null,
      method: d.method ?? null, coffee, doseG: d.doseG, waterG: d.waterG, tempC: d.tempC ?? null, grinderId: d.grinderId || null,
      grinderName: (d.grinderId && names.get(d.grinderId)) || d.grinderName || null, grindSetting: d.grindSetting ?? null,
      steps: JSON.stringify(d.steps ?? []), notes: d.notes ?? null, favorite: d.favorite ? 1 : 0, inventoryId: d.inventoryId ?? null,
      waterId: d.waterId ?? null, waterName: waterNameFor(db, d.waterId, d.waterName), roastLevel: normalizeRoastLevel(d.roastLevel),
    };
  };
  const identicalExists = (vals: any, exceptId?: number) => {
    const k = recipeKey(vals);
    return (db.prepare("SELECT * FROM recipes WHERE lower(name)=lower(?)").all(vals.name) as any[]).find(
      (x) => x.id !== exceptId && recipeKey(x) === k,
    );
  };
  const insertRecipe = (vals: any) => {
    const t = nowIso();
    const info = db
      .prepare(
        `INSERT INTO recipes (name, brewerId, brewerName, method, coffee, doseG, waterG, tempC, grinderId, grinderName, grindSetting, steps, notes, favorite, starter, inventoryId, waterId, waterName, roastLevel, createdAt, updatedAt)
         VALUES (@name, @brewerId, @brewerName, @method, @coffee, @doseG, @waterG, @tempC, @grinderId, @grinderName, @grindSetting, @steps, @notes, @favorite, 0, @inventoryId, @waterId, @waterName, @roastLevel, @t, @t)`,
      )
      .run({ ...vals, t });
    return recipeRow(db.prepare("SELECT * FROM recipes WHERE id=?").get(info.lastInsertRowid));
  };

  r.post("/recipes", (req, res) => {
    const p = RecipeSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    try {
      const vals = recipeValues(p.data);
      const dup = identicalExists(vals);
      if (dup) return res.status(409).json({ error: `An identical recipe "${dup.name}" is already saved.`, existing: recipeRow(dup) });
      res.json(insertRecipe(vals));
    } catch (e: any) {
      bad(res, e.message);
    }
  });
  r.put("/recipes/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM recipes WHERE id=?").get(id)) return bad(res, "Recipe not found", 404);
    const p = RecipeSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    try {
      const vals = recipeValues(p.data);
      const dup = identicalExists(vals, id);
      if (dup) return res.status(409).json({ error: `An identical recipe "${dup.name}" is already saved.` });
      db.prepare(
        `UPDATE recipes SET name=@name, brewerId=@brewerId, brewerName=@brewerName, method=@method, coffee=@coffee, doseG=@doseG, waterG=@waterG,
         tempC=@tempC, grinderId=@grinderId, grinderName=@grinderName, grindSetting=@grindSetting, steps=@steps, notes=@notes,
         favorite=@favorite, inventoryId=@inventoryId, waterId=@waterId, waterName=@waterName, roastLevel=@roastLevel, updatedAt=@t WHERE id=@id`,
      ).run({ ...vals, id, t: nowIso() });
      res.json(recipeRow(db.prepare("SELECT * FROM recipes WHERE id=?").get(id)));
    } catch (e: any) {
      bad(res, e.message);
    }
  });
  r.patch("/recipes/:id/favorite", (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM recipes WHERE id=?").get(id)) return bad(res, "Recipe not found", 404);
    if (typeof req.body?.favorite !== "boolean") return bad(res, "favorite must be true or false");
    db.prepare("UPDATE recipes SET favorite=?, updatedAt=? WHERE id=?").run(req.body.favorite ? 1 : 0, nowIso(), id);
    res.json(recipeRow(db.prepare("SELECT * FROM recipes WHERE id=?").get(id)));
  });
  r.delete("/recipes/:id", (req, res) => {
    // Brews keep their recorded recipe name.
    db.prepare("UPDATE brews SET recipeId=NULL WHERE recipeId=?").run(req.params.id);
    db.prepare("DELETE FROM recipes WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  /** Copy Recipe: saves "<name> (Copy)" once; refuses an identical second copy. */
  r.post("/recipes/:id/copy", (req, res) => {
    const src = db.prepare("SELECT * FROM recipes WHERE id=?").get(req.params.id) as any;
    if (!src) return bad(res, "Recipe not found", 404);
    const vals = {
      name: `${src.name} (Copy)`, brewerId: src.brewerId, brewerName: src.brewerName, method: src.method, coffee: src.coffee,
      doseG: src.doseG, waterG: src.waterG, tempC: src.tempC, grinderId: src.grinderId, grinderName: src.grinderName,
      grindSetting: src.grindSetting, steps: src.steps, notes: src.notes, favorite: 0, inventoryId: src.inventoryId,
      waterId: src.waterId ?? null, waterName: src.waterName ?? null, roastLevel: src.roastLevel ?? null,
    };
    const dup = identicalExists(vals);
    if (dup) return res.status(409).json({ error: `"${dup.name}" is already saved — no second identical copy was made.`, existing: recipeRow(dup) });
    // A differently-edited copy already holds the name: number this one.
    let n = 2;
    while (db.prepare("SELECT 1 FROM recipes WHERE lower(name)=lower(?)").get(vals.name)) vals.name = `${src.name} (Copy ${n++})`;
    res.json(insertRecipe(vals));
  });

  /* ---------- brews ---------- */
  r.get("/brews", (_req, res) => {
    res.json((db.prepare("SELECT * FROM brews ORDER BY brewedAt DESC, id DESC").all() as any[]).map(brewRow));
  });
  const brewValues = (d: z.infer<typeof BrewSchema>) => {
    const names = gearNames();
    let coffee = d.coffee ?? null;
    if (d.inventoryId != null) {
      const bag = db.prepare("SELECT name FROM inventory_items WHERE id=?").get(d.inventoryId) as any;
      if (!bag) throw new Error("That inventory bag no longer exists.");
      coffee = coffee || bag.name;
    }
    let recipeName = d.recipeName ?? null;
    if (d.recipeId != null && !recipeName) recipeName = (db.prepare("SELECT name FROM recipes WHERE id=?").get(d.recipeId) as any)?.name ?? null;
    return {
      recipeId: d.recipeId ?? null, recipeName, brewerId: d.brewerId || null,
      brewerName: (d.brewerId && names.get(d.brewerId)) || d.brewerName || null, method: d.method ?? null, coffee,
      doseG: d.doseG, waterG: d.waterG, tempC: d.tempC ?? null, grinderId: d.grinderId || null,
      grinderName: (d.grinderId && names.get(d.grinderId)) || d.grinderName || null, grindSetting: d.grindSetting ?? null,
      steps: d.steps ? JSON.stringify(d.steps) : null, inventoryId: d.inventoryId ?? null, rating: d.rating ?? null,
      notes: d.notes ?? null, totalTimeSec: d.totalTimeSec == null ? null : Math.round(d.totalTimeSec), brewedAt: d.brewedAt || nowIso(),
      waterId: d.waterId ?? null, waterName: waterNameFor(db, d.waterId, d.waterName),
    };
  };
  r.post("/brews", (req, res) => {
    const p = BrewSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    try {
      const v = brewValues(p.data);
      const info = db
        .prepare(
          `INSERT INTO brews (recipeId, recipeName, brewerId, brewerName, method, coffee, doseG, waterG, tempC, grinderId, grinderName, grindSetting, steps, inventoryId, rating, notes, totalTimeSec, brewedAt, waterId, waterName)
           VALUES (@recipeId, @recipeName, @brewerId, @brewerName, @method, @coffee, @doseG, @waterG, @tempC, @grinderId, @grinderName, @grindSetting, @steps, @inventoryId, @rating, @notes, @totalTimeSec, @brewedAt, @waterId, @waterName)`,
        )
        .run(v);
      res.json(brewRow(db.prepare("SELECT * FROM brews WHERE id=?").get(info.lastInsertRowid)));
    } catch (e: any) {
      bad(res, e.message);
    }
  });
  r.put("/brews/:id", (req, res) => {
    const id = Number(req.params.id);
    const ex = db.prepare("SELECT * FROM brews WHERE id=?").get(id) as any;
    if (!ex) return bad(res, "Brew not found", 404);
    const p = BrewSchema.safeParse({ ...brewRow(ex), ...req.body });
    if (!p.success) return bad(res, firstError(p.error));
    try {
      const v = brewValues(p.data);
      db.prepare(
        `UPDATE brews SET recipeId=@recipeId, recipeName=@recipeName, brewerId=@brewerId, brewerName=@brewerName, method=@method, coffee=@coffee,
         doseG=@doseG, waterG=@waterG, tempC=@tempC, grinderId=@grinderId, grinderName=@grinderName, grindSetting=@grindSetting, steps=@steps,
         inventoryId=@inventoryId, rating=@rating, notes=@notes, totalTimeSec=@totalTimeSec, brewedAt=@brewedAt, waterId=@waterId, waterName=@waterName WHERE id=@id`,
      ).run({ ...v, id });
      res.json(brewRow(db.prepare("SELECT * FROM brews WHERE id=?").get(id)));
    } catch (e: any) {
      bad(res, e.message);
    }
  });
  r.delete("/brews/:id", (req, res) => {
    db.prepare("DELETE FROM brews WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  /* ---------- inventory (Stash) ---------- */
  const ORDER = `CASE WHEN finishedDate IS NOT NULL THEN 2 WHEN openedDate IS NOT NULL THEN 0 ELSE 1 END, COALESCE(openedDate, purchaseDate, createdAt) DESC`;
  r.get("/inventory", (_req, res) => {
    res.json((db.prepare(`SELECT * FROM inventory_items ORDER BY ${ORDER}`).all() as any[]).map((x) => inventoryRow(db, x)));
  });
  r.get("/inventory/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM inventory_items WHERE id=?").get(req.params.id);
    if (!row) return bad(res, "Bag not found", 404);
    const recipes = (db.prepare("SELECT * FROM recipes WHERE inventoryId=? ORDER BY name").all(req.params.id) as any[]).map(recipeRow);
    const brews = (db.prepare("SELECT * FROM brews WHERE inventoryId=? ORDER BY brewedAt DESC").all(req.params.id) as any[]).map(brewRow);
    res.json({ ...inventoryRow(db, row), recipes, brews });
  });
  const invValues = (d: z.infer<typeof InventorySchema>) => {
    if (d.openedDate && d.roastDate && d.openedDate < d.roastDate) throw new Error("Opened date can't be before the roast date.");
    if (d.finishedDate && d.openedDate && d.finishedDate < d.openedDate) throw new Error("Finished date can't be before the opened date.");
    return {
      name: d.name, roaster: d.roaster ?? null, origin: d.origin ?? null, processMethod: d.processMethod ?? null, roastLevel: normalizeRoastLevel(d.roastLevel),
      tastingNotes: JSON.stringify(cleanTags(d.tastingNotes)),
      roastDate: d.roastDate ?? null, purchaseDate: d.purchaseDate ?? null, openedDate: d.openedDate ?? null, finishedDate: d.finishedDate ?? null,
      amountG: d.amountG ?? null, price: d.price ?? null, url: d.url ?? null, rating: d.rating ?? null, notes: d.notes ?? null,
      source: d.source ?? "manual", status: deriveStatus(d), photo: d.photo ?? null,
    };
  };
  r.post("/inventory", (req, res) => {
    const p = InventorySchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    try {
      const v = invValues(p.data);
      const t = nowIso();
      const info = db
        .prepare(
          `INSERT INTO inventory_items (name, roaster, origin, processMethod, roastLevel, roastDate, purchaseDate, openedDate, finishedDate, amountG, price, url, rating, notes, tastingNotes, source, status, photo, createdAt, updatedAt)
           VALUES (@name, @roaster, @origin, @processMethod, @roastLevel, @roastDate, @purchaseDate, @openedDate, @finishedDate, @amountG, @price, @url, @rating, @notes, @tastingNotes, @source, @status, @photo, @t, @t)`,
        )
        .run({ ...v, t });
      res.json(inventoryRow(db, db.prepare("SELECT * FROM inventory_items WHERE id=?").get(info.lastInsertRowid)));
    } catch (e: any) {
      bad(res, e.message);
    }
  });
  r.put("/inventory/:id", (req, res) => {
    const id = Number(req.params.id);
    const ex = db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id) as any;
    if (!ex) return bad(res, "Bag not found", 404);
    const p = InventorySchema.safeParse({ ...ex, tastingNotes: parseTags(ex.tastingNotes), ...req.body });
    if (!p.success) return bad(res, firstError(p.error));
    try {
      const v = invValues(p.data);
      db.prepare(
        `UPDATE inventory_items SET name=@name, roaster=@roaster, origin=@origin, processMethod=@processMethod, roastLevel=@roastLevel, roastDate=@roastDate,
         purchaseDate=@purchaseDate, openedDate=@openedDate, finishedDate=@finishedDate, amountG=@amountG, price=@price, url=@url, rating=@rating,
         notes=@notes, tastingNotes=@tastingNotes, source=@source, status=@status, photo=@photo, updatedAt=@t WHERE id=@id`,
      ).run({ ...v, id, t: nowIso() });
      if (ex.photo && ex.photo !== v.photo) removeUpload(db, ex.photo);
      res.json(inventoryRow(db, db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id)));
    } catch (e: any) {
      bad(res, e.message);
    }
  });
  const stamp = (field: "openedDate" | "finishedDate") => (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const ex = db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id) as any;
    if (!ex) return bad(res, "Bag not found", 404);
    // Finishing can also log a verdict to the tasting log (keeps the Discover matching rules current).
    let tasting: any = null;
    let alreadyLogged = false;
    if (field === "finishedDate" && req.body?.verdict) {
      const p = TastingSchema.safeParse({ name: ex.name, roaster: ex.roaster, origin: ex.origin, processMethod: ex.processMethod, verdict: req.body.verdict, notes: req.body.notes || null });
      if (!p.success) return bad(res, firstError(p.error));
      const existing = (db.prepare("SELECT * FROM tastings").all() as any[]).find((t) => sameCoffee(t, ex));
      if (existing) {
        alreadyLogged = true;
        tasting = existing;
      } else {
        const d = p.data;
        const info = db.prepare("INSERT INTO tastings (name, roaster, origin, processMethod, verdict, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(d.name, d.roaster ?? null, d.origin ?? null, d.processMethod ?? null, d.verdict, d.notes ?? null, nowIso());
        tasting = db.prepare("SELECT * FROM tastings WHERE id=?").get(info.lastInsertRowid);
      }
      for (const pk of db.prepare("SELECT id, name, roaster FROM picks WHERE status != 'tried'").all() as any[])
        if (sameCoffee(pk, ex)) db.prepare("UPDATE picks SET status='tried' WHERE id=?").run(pk.id);
    }
    const date = typeof req.body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : todayLocal();
    const next = { ...ex, [field]: date };
    if (field === "finishedDate" && !next.openedDate) next.openedDate = date; // finishing implies it was opened
    const t = nowIso();
    db.prepare("UPDATE inventory_items SET openedDate=?, finishedDate=?, status=?, updatedAt=? WHERE id=?")
      .run(next.openedDate, next.finishedDate, deriveStatus(next), t, id);
    const bag = inventoryRow(db, db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id));
    res.json(field === "finishedDate" ? { ...bag, tasting, alreadyLogged } : bag);
  };
  r.post("/inventory/:id/open", stamp("openedDate"));
  /** "Edit what's left": the gap to the logged brews is recorded as coffee used without a brew. */
  r.post("/inventory/:id/remaining", (req, res) => {
    const id = Number(req.params.id);
    const ex = db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id) as any;
    if (!ex) return bad(res, "Bag not found", 404);
    if (ex.amountG == null) return bad(res, "Add the bag size first.");
    const left = req.body?.remainingG;
    if (typeof left !== "number" || !Number.isFinite(left) || left < 0 || left > ex.amountG)
      return bad(res, `What's left must be between 0 and the bag size (${ex.amountG} g).`);
    const used = (db.prepare("SELECT COALESCE(SUM(doseG),0) s FROM brews WHERE inventoryId=?").get(id) as { s: number }).s;
    db.prepare("UPDATE inventory_items SET unloggedG=?, updatedAt=? WHERE id=?").run(Math.round((ex.amountG - used - left) * 10) / 10, nowIso(), id);
    res.json(inventoryRow(db, db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id)));
  });
  r.post("/inventory/:id/finish", stamp("finishedDate"));
  r.delete("/inventory/:id", (req, res) => {
    const id = Number(req.params.id);
    const bag = db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id) as any;
    if (!bag) return bad(res, "Bag not found", 404);
    db.transaction(() => {
      // Linked recipes/brews keep their coffee name and lose the link.
      for (const t of ["recipes", "brews"]) db.prepare(`UPDATE ${t} SET coffee=COALESCE(coffee, ?), inventoryId=NULL WHERE inventoryId=?`).run(bag.name, id);
      db.prepare("DELETE FROM inventory_items WHERE id=?").run(id);
      if (bag.photo) removeUpload(db, bag.photo);
      // Picks for this coffee are no longer "in inventory" unless another bag still matches.
      const remaining = db.prepare("SELECT name, roaster FROM inventory_items").all() as any[];
      for (const p of db.prepare("SELECT id, name, roaster FROM picks WHERE inventoryState='added'").all() as any[])
        if (sameCoffee(p, bag) && !remaining.some((x) => sameCoffee(p, x))) db.prepare("UPDATE picks SET inventoryState='not_added' WHERE id=?").run(p.id);
    })();
    res.json({ ok: true });
  });

  /** addToInventory endpoint — accepts exactly a recommendation's fields. */
  r.post("/inventory/add-from-recommendation", (req, res) => {
    const p = RecommendationSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    res.json(addToInventory(db, p.data));
  });

  /* ---------- imports ---------- */
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => cb(null, `bag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${file.mimetype === "image/png" ? ".png" : ".jpg"}`),
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png"].includes(file.mimetype)),
  });
  r.post("/import/photo", (req, res) => {
    upload.single("photo")(req, res, async (err: any) => {
      if (err) return bad(res, err.code === "LIMIT_FILE_SIZE" ? "That photo is over 15 MB." : `Upload failed: ${err.message}`);
      if (!req.file) return bad(res, "Choose a JPEG or PNG photo of the bag.");
      const photo = `/uploads/${path.basename(req.file.path)}`;
      if (req.query.read === "0") return res.json({ found: false, message: "Photo attached.", source: "upload", photo });
      const buffer = fs.readFileSync(req.file.path);
      const result = await importFromPhoto({ path: req.file.path, buffer, mimetype: req.file.mimetype });
      res.json({ ...result, photo });
    });
  });
  /** After a label read (or typed name/roaster): find the coffee on the roaster's site. */
  r.post("/import/lookup", async (req, res) => {
    const b = req.body ?? {};
    const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : undefined);
    res.json(await lookupOnline({ name: str(b.name), roaster: str(b.roaster), origin: str(b.origin), processMethod: str(b.processMethod), roastLevel: str(b.roastLevel) }));
  });
  r.post("/import/link", async (req, res) => {
    const url = String(req.body?.url ?? "").trim();
    if (!url) return bad(res, "Paste the roaster's product link first.");
    res.json(await importFromLink(url));
  });

  return r;
}
