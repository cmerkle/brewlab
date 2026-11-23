// The gear & recipe library ("catalog") — data files under catalog/, not code.
//   catalog/gear/<id>.json      one entry per model (grinder / brewer / other)
//   catalog/recipes/<id>.json   recipe templates; grind is a POSITION inside the method's range,
//                               so a template renders onto any grinder that has ranges.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { METHODS, formatSetting, rangeFor, type GrindRanges, type Method } from "../shared/grind.js";

export const CATALOG_DIR = process.env.CATALOG_DIR || path.resolve("catalog");

const Range = z.object({ low: z.number(), high: z.number() }).refine((r) => r.low <= r.high, "low must be ≤ high");
const GrindRangesSchema = z.object({
  scale: z.string().optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  step: z.number().positive().nullable().optional(),
  notation: z.enum(["decimal", "thirds"]).optional(),
  dialDivisor: z.number().positive().nullable().optional(),
  methods: z.partialRecord(z.enum(METHODS), Range),
  notes: z.partialRecord(z.enum(METHODS), z.string()).optional(),
});

export const CATEGORIES = [
  "hand-grinder", "electric-grinder",
  "cone-dripper", "flat-bottom-dripper", "hybrid-dripper", "immersion-dripper", "aeropress", "rapid-brewer",
  "french-press", "moka-pot", "espresso-machine", "batch-brewer", "other",
] as const;

export const CatalogGear = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.number().int().positive(),
  name: z.string().min(1),
  brand: z.string().nullable(),
  type: z.enum(["grinder", "brewer", "other"]),
  category: z.enum(CATEGORIES),
  details: z.string().nullable().optional(),
  units: z.string().nullable().optional(),
  burrs: z.string().nullable().optional(),
  espressoCapable: z.boolean().nullable().optional(),
  variants: z.array(z.string()).nullable().optional(),
  defaultMethod: z.enum(METHODS).nullable().optional(),
  grindRanges: GrindRangesSchema.optional(),
  rangeInfo: z.object({
    confidence: z.enum(["manufacturer", "community", "drafted"]),
    source: z.string().url().nullable(),
    note: z.string().optional(),
  }).optional(),
}).superRefine((g, ctx) => {
  if (g.grindRanges && !g.rangeInfo) ctx.addIssue({ code: "custom", message: "grindRanges need rangeInfo (confidence + source)" });
  if (g.rangeInfo && g.rangeInfo.confidence !== "drafted" && !g.rangeInfo.source)
    ctx.addIssue({ code: "custom", message: "manufacturer/community ranges must cite a source URL" });
});
export type CatalogGearT = z.infer<typeof CatalogGear>;

const Step = z.object({ label: z.string(), detail: z.string().nullable().optional(), targetWaterG: z.number().nullable().optional(), atSec: z.number().nullable().optional() });
export const RecipeTemplate = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  legacyId: z.number().int().optional(),
  version: z.number().int().positive(),
  name: z.string().min(1),
  /** Name used when the recipe lands on someone else's brewer (matched by category, not id). */
  genericName: z.string().optional(),
  /** Variants of one method (e.g. Show Horse on V60 02 / V60 03 / Switch): offer one per brewer. */
  family: z.string().optional(),
  credit: z.string().nullable().optional(),
  method: z.enum(METHODS),
  brewer: z.object({ ids: z.array(z.string()).default([]), categories: z.array(z.enum(CATEGORIES)).default([]) }),
  doseG: z.number().positive(),
  waterG: z.number().positive(),
  tempC: z.number().nullable(),
  grind: z.object({ position: z.number().min(-0.5).max(1.5), preferredGrinders: z.array(z.string()).default([]) }),
  steps: z.array(Step),
  notes: z.string().nullable().optional(),
});
export type RecipeTemplateT = z.infer<typeof RecipeTemplate>;

function loadDir<T>(dir: string, schema: z.ZodType<T>): { items: T[]; errors: string[] } {
  const items: T[] = [];
  const errors: string[] = [];
  if (!fs.existsSync(dir)) return { items, errors: [`missing directory ${dir}`] };
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const r = schema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (r.success) {
        if ((r.data as any).id !== f.replace(/\.json$/, "")) errors.push(`${f}: id must match the file name`);
        else items.push(r.data);
      } else errors.push(`${f}: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
    } catch (e: any) {
      errors.push(`${f}: ${e.message}`);
    }
  }
  return { items, errors };
}

let cache: { gear: CatalogGearT[]; recipes: RecipeTemplateT[]; errors: string[] } | null = null;
export function loadCatalog(dir = CATALOG_DIR, fresh = false) {
  if (cache && !fresh && dir === CATALOG_DIR) return cache;
  const g = loadDir(path.join(dir, "gear"), CatalogGear);
  const r = loadDir(path.join(dir, "recipes"), RecipeTemplate);
  const out = { gear: g.items, recipes: r.items, errors: [...g.errors.map((e) => `gear/${e}`), ...r.errors.map((e) => `recipes/${e}`)] };
  if (dir === CATALOG_DIR) cache = out;
  return out;
}
export const catalogGear = (id: string) => loadCatalog().gear.find((g) => g.id === id) ?? null;
export const catalogRecipe = (id: string) => loadCatalog().recipes.find((r) => r.id === id) ?? null;

/** Owned gear, as the renderer needs it. */
export interface OwnedGear {
  id: string;
  catalogId?: string | null;
  name: string;
  type: string;
  category?: string | null;
  units?: string | null;
  grindRanges?: GrindRanges | null;
}

/** Render a template onto the user's gear → recipe values (no DB ids). */
export function renderTemplate(t: RecipeTemplateT, owned: OwnedGear[]) {
  const brewers = owned.filter((g) => g.type === "brewer");
  // Owned copies of a library model keep its id as catalogId (a second ZP6 is "zp6-2").
  const isModel = (b: OwnedGear, id: string) => b.id === id || b.catalogId === id;
  const byId = t.brewer.ids.map((id) => brewers.find((b) => isModel(b, id))).find(Boolean) ?? null;
  const brewer = byId ?? brewers.find((b) => b.category && t.brewer.categories.includes(b.category as any)) ?? null;
  const matchedBy: "id" | "category" | null = byId ? "id" : brewer ? "category" : null;
  const grinders = owned.filter((g) => g.type === "grinder");
  const m: Method = t.method;
  const withRange = (g: OwnedGear) => Boolean(rangeFor(g, m));
  const grinder =
    t.grind.preferredGrinders.map((id) => grinders.find((g) => (g.id === id || g.catalogId === id) && withRange(g))).find(Boolean) ??
    grinders.find(withRange) ??
    grinders[0] ?? null;
  let grindSetting: string | null = null;
  const r = grinder ? rangeFor(grinder, m) : null;
  if (grinder && r) {
    const raw = r.low + t.grind.position * (r.high - r.low);
    const step = grinder.grindRanges?.step;
    const v = step ? Math.round(Math.round(raw / step) * step * 1000) / 1000 : Math.round(raw * 100) / 100;
    grindSetting = formatSetting(grinder, v);
  }
  return {
    name: matchedBy === "category" && t.genericName ? t.genericName : t.name,
    matchedBy,
    brewerId: brewer?.id ?? null,
    brewerName: brewer?.name ?? null,
    method: m,
    doseG: t.doseG,
    waterG: t.waterG,
    tempC: t.tempC,
    grinderId: grinder?.id ?? null,
    grinderName: grinder?.name ?? null,
    grindSetting,
    steps: t.steps,
    notes: [t.notes, t.credit && !t.notes?.includes(t.credit) ? `Method: ${t.credit}.` : null].filter(Boolean).join(" ") || null,
    compatible: Boolean(brewer),
  };
}

/** Templates the user's gear can brew, rendered — one per (family, brewer): an exact model match
    beats a category match, so a single V60 gets one "Show Horse", not three. */
export function compatibleTemplates(owned: OwnedGear[]) {
  const out = new Map<string, { template: RecipeTemplateT; rendered: ReturnType<typeof renderTemplate> }>();
  for (const t of loadCatalog().recipes) {
    const r = renderTemplate(t, owned);
    if (!r.compatible) continue;
    const key = `${t.family ?? t.id}::${r.brewerId}`;
    const prev = out.get(key);
    if (!prev || (prev.rendered.matchedBy === "category" && r.matchedBy === "id")) out.set(key, { template: t, rendered: r });
  }
  return [...out.values()];
}

/** Gear row values for a library entry (installed as a user-owned, editable copy). */
export function gearFromCatalog(c: CatalogGearT) {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    brand: c.brand ?? null,
    details: c.details ?? null,
    units: c.units ?? null,
    burrs: c.burrs ?? null,
    espressoCapable: c.espressoCapable == null ? null : c.espressoCapable ? 1 : 0,
    variants: c.variants ? JSON.stringify(c.variants) : null,
    grindRanges: c.grindRanges ? JSON.stringify(c.grindRanges) : null,
    defaultMethod: c.defaultMethod ?? null,
    catalogId: c.id,
    catalogVersion: c.version,
    category: c.category,
  };
}
