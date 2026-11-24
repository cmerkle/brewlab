// The gear & recipe library ("catalog") — data files under catalog/, not code.
//   catalog/gear/<id>.json      one entry per model (grinder / brewer / other)
//   catalog/recipes/<id>.json   recipe templates; grind is a POSITION inside the method's range,
//                               so a template renders onto any grinder that has ranges.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { METHODS, valueToDial, rangeFor, type GrindRanges, type Method } from "../shared/grind.js";
import { evalExpr, type EstimateRules } from "../shared/estimate.js";
import { AMOUNT_UNITS, VOLUME_UNITS, convertAmount, type WaterAdditive, type WaterBase, type WaterLine } from "../shared/water.js";

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
  /** Brew methods this grinder can't do. */
  unsupported: z.array(z.enum(METHODS)).optional(),
});

export const CATEGORIES = [
  "hand-grinder", "electric-grinder",
  "cone-dripper", "flat-bottom-dripper", "hybrid-dripper", "immersion-dripper", "aeropress", "rapid-brewer",
  "french-press", "moka-pot", "espresso-machine", "batch-brewer", "cezve", "cold-brew-maker", "siphon", "other",
] as const;

export const CatalogGear = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.number().int().positive(),
  name: z.string().min(1),
  brand: z.string().nullable(),
  type: z.enum(["grinder", "brewer"], { message: "type must be grinder or brewer — the library has no other gear" }),
  category: z.enum(CATEGORIES),
  details: z.string().nullable().optional(),
  units: z.string().nullable().optional(),
  burrs: z.string().nullable().optional(),
  variants: z.array(z.string()).nullable().optional(),
  defaultMethod: z.enum(METHODS).nullable().optional(),
  grindRanges: GrindRangesSchema.optional(),
  rangeInfo: z.object({
    // Checked below (not as an enum here) so every rule runs and reports at once.
    confidence: z.string() as z.ZodType<"manufacturer" | "community">,
    source: z.string().url().nullable(),
    note: z.string().optional(),
    /** Methods whose range is extrapolated from the cited ones, not taken from the source. */
    estimated: z.array(z.enum(METHODS)).optional(),
    /** How the estimated ranges were derived (required when there are any). */
    estimateNote: z.string().optional(),
  }).optional(),
}).superRefine((g, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });
  // The library's contribution rules (CONTRIBUTING.md) — the app, `npm test`, `npm run check:catalog`
  // and the in-app "Suggest to the library" all check exactly these.
  if (g.grindRanges && !g.rangeInfo) issue("grind ranges need a rangeInfo saying where they come from (confidence + source)", ["rangeInfo"]);
  if (g.rangeInfo && !g.grindRanges) issue("rangeInfo without grindRanges — remove it, or add the ranges", ["rangeInfo"]);
  if (g.rangeInfo && !["manufacturer", "community"].includes(g.rangeInfo.confidence))
    issue(g.rangeInfo.confidence
      ? `must be "manufacturer" or "community", not "${g.rangeInfo.confidence}" — the library only takes ranges with a cited source`
      : 'choose where the ranges come from: "manufacturer" or "community"', ["rangeInfo", "confidence"]);
  if (g.rangeInfo && !g.rangeInfo.source) issue("cite a source URL for the ranges (the manufacturer's manual/chart, or a published community chart)", ["rangeInfo", "source"]);
  if (g.rangeInfo?.source && !/^https:\/\//.test(g.rangeInfo.source)) issue("the source must be an https:// link", ["rangeInfo", "source"]);
  const est = g.rangeInfo?.estimated ?? [];
  for (const m of est) if (!g.grindRanges?.methods?.[m]) issue(`"${m}" is listed as estimated but has no range`, ["rangeInfo", "estimated"]);
  if (est.length && !g.rangeInfo?.estimateNote?.trim()) issue("say how the estimated ranges were worked out (rangeInfo.estimateNote)", ["rangeInfo", "estimateNote"]);
  if (est.length && g.grindRanges && Object.keys(g.grindRanges.methods).every((m) => est.includes(m as Method)))
    issue("at least one range must come from the cited source — estimates extrapolate from it", ["rangeInfo", "estimated"]);
  const isGrinderCat = g.category.endsWith("-grinder");
  if (g.type === "grinder" && !isGrinderCat) issue(`a grinder needs a grinder category (hand-grinder or electric-grinder), not "${g.category}"`, ["category"]);
  if (g.type !== "grinder" && isGrinderCat) issue(`category "${g.category}" is for grinders, but type is "${g.type}"`, ["category"]);
  if (g.type !== "grinder" && g.grindRanges) issue("only grinders have grind ranges", ["grindRanges"]);
  if (g.type !== "brewer" && g.defaultMethod) issue("defaultMethod is for brewers", ["defaultMethod"]);
  if (g.type === "brewer" && !g.defaultMethod)
    issue("a brewer needs a grind category (defaultMethod): which grinder range it uses — espresso, pourover, immersion …", ["defaultMethod"]);
  const r = g.grindRanges;
  if (r) {
    if (!Object.keys(r.methods).length && !r.unsupported?.length) issue("grindRanges has no methods — add at least one, or leave grindRanges out", ["grindRanges", "methods"]);
    for (const m of r.unsupported ?? []) {
      if (r.methods[m]) issue(`"${m}" is marked as one this grinder can't do, but has a range — remove one or the other`, ["grindRanges", "unsupported"]);
      if (g.rangeInfo?.estimated?.includes(m)) issue(`"${m}" is marked as one this grinder can't do, so it can't be estimated`, ["rangeInfo", "estimated"]);
    }
    if (r.min != null && r.max != null && r.min > r.max) issue("grindRanges.min is above max", ["grindRanges"]);
    for (const [m, v] of Object.entries(r.methods)) {
      if (!v) continue;
      if (r.min != null && v.low < r.min) issue(`${m}: low ${v.low} is below the grinder's min ${r.min}`, ["grindRanges", "methods", m]);
      if (r.max != null && v.high > r.max) issue(`${m}: high ${v.high} is above the grinder's max ${r.max}`, ["grindRanges", "methods", m]);
    }
    if (r.notation === "thirds" && r.step != null && Math.abs(r.step - 1 / 3) > 1e-6) issue('notation "thirds" needs step 1/3', ["grindRanges", "step"]);
  }
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
      } else errors.push(...r.error.issues.map((i) => `${f}: ${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`));
    } catch (e: any) {
      errors.push(`${f}: ${e.message}`);
    }
  }
  return { items, errors };
}

let cache: { gear: CatalogGearT[]; recipes: RecipeTemplateT[]; errors: string[] } | null = null;
/* ---------- estimate rules (catalog/estimate-rules.json) ---------- */

const EstimateRuleSchema = z.object({
  needs: z.array(z.enum(METHODS)),
  low: z.string().min(1),
  high: z.string().min(1),
  note: z.string().min(1),
});
export const EstimateRulesSchema = z.object({
  about: z.string().optional(),
  version: z.number().int().positive(),
  notePrefix: z.string(),
  noteSuffix: z.string(),
  order: z.array(z.enum(METHODS)),
  rules: z.partialRecord(z.enum(METHODS), z.array(EstimateRuleSchema)),
}).superRefine((r, ctx) => {
  // Every expression must read, and only use methods the rule says it needs.
  for (const [m, alts] of Object.entries(r.rules)) {
    (alts ?? []).forEach((a, i) => {
      for (const k of ["low", "high"] as const) {
        try {
          evalExpr(a[k], (name) => {
            if (name === "min") return 0;
            const [meth, part] = name.split(".");
            if (!a.needs.includes(meth as Method)) throw new Error(`uses ${meth} but doesn't list it in needs`);
            if (!["low", "high", "mid", "span"].includes(part)) throw new Error(`unknown "${name}"`);
            return 1;
          });
        } catch (e: any) {
          ctx.addIssue({ code: "custom", message: `${m}[${i}].${k}: ${e.message}`, path: ["rules", m, i, k] });
        }
      }
      if (a.needs.includes(m as Method)) ctx.addIssue({ code: "custom", message: `${m}[${i}] can't need itself`, path: ["rules", m, i, "needs"] });
    });
  }
});

let rulesCache: { rules: EstimateRules | null; error: string | null } | null = null;
export function loadEstimateRules(dir = CATALOG_DIR, fresh = false): { rules: EstimateRules | null; error: string | null } {
  if (rulesCache && !fresh && dir === CATALOG_DIR) return rulesCache;
  let out: { rules: EstimateRules | null; error: string | null };
  try {
    const p = EstimateRulesSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, "estimate-rules.json"), "utf8")));
    out = p.success ? { rules: p.data as EstimateRules, error: null } : { rules: null, error: p.error.issues.map((i) => i.message).join("; ") };
  } catch (e: any) {
    out = { rules: null, error: e.message };
  }
  if (dir === CATALOG_DIR) rulesCache = out;
  return out;
}

export function loadCatalog(dir = CATALOG_DIR, fresh = false) {
  if (cache && !fresh && dir === CATALOG_DIR) return cache;
  const g = loadDir(path.join(dir, "gear"), CatalogGear);
  const r = loadDir(path.join(dir, "recipes"), RecipeTemplate);
  const er = loadEstimateRules(dir, fresh);
  const out = { gear: g.items, recipes: r.items, errors: [...g.errors.map((e) => `gear/${e}`), ...r.errors.map((e) => `recipes/${e}`), ...(er.error ? [`estimate-rules.json: ${er.error}`] : [])] };
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
  let grindSetting: number | null = null;
  const r = grinder ? rangeFor(grinder, m) : null;
  if (grinder && r) grindSetting = valueToDial(grinder, r.low + t.grind.position * (r.high - r.low));
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

/* ------------------------------ "Suggest to the library" ------------------------------ */

/** The public repo contributions go to (pull requests against catalog/). */
export const LIBRARY_REPO = process.env.LIBRARY_REPO || "cmerkle/brewlab";

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export interface GearRowForEntry {
  id: string; name: string; type: string; brand: string | null; category: string | null; details: string | null;
  units: string | null; burrs: string | null; variants: string[] | null;
  defaultMethod: string | null; grindRanges: GrindRanges | null; catalogId: string | null;
  rangeInfo?: GearRangeInfo | null;
}

/** Where a gear item's ranges come from — stored on the item, editable (gear_items.rangeInfo). */
export interface GearRangeInfo {
  confidence?: "manufacturer" | "community" | null;
  source?: string | null;
  note?: string | null;
  estimated?: Method[];
  estimateNote?: string | null;
}

/** The library's rangeInfo as stored on an installed copy. */
export function rangeInfoFromCatalog(c: CatalogGearT): GearRangeInfo | null {
  const r = c.rangeInfo;
  if (!r || !c.grindRanges) return null;
  return { confidence: r.confidence, source: r.source ?? null, note: r.note ?? null, estimated: r.estimated ?? [], estimateNote: r.estimateNote ?? null };
}

/**
 * A ready-to-submit library entry for a gear item: a NEW entry for custom gear, or an UPDATE of
 * the library entry it came from (its saved ranges + where they come from, version bumped).
 * Validated with the same schema as the library, so what the app says is fine, CI says is fine.
 */
export function libraryEntryFor(g: GearRowForEntry, info: { confidence?: string; source?: string; note?: string }) {
  const base = g.catalogId ? catalogGear(g.catalogId) : null;
  const ranges = g.type === "grinder" && g.grindRanges && (Object.keys(g.grindRanges.methods ?? {}).length || g.grindRanges.unsupported?.length) ? g.grindRanges : null;
  const est = (g.rangeInfo?.estimated ?? []).filter((m) => ranges?.methods?.[m]);
  const source = info.source ?? g.rangeInfo?.source ?? undefined;
  const note = info.note ?? g.rangeInfo?.note ?? undefined;
  const rangeInfo = ranges
    ? {
        confidence: info.confidence ?? g.rangeInfo?.confidence ?? "", source: source?.trim() || null, ...(note?.trim() ? { note: note.trim() } : {}),
        ...(est.length ? { estimated: est, estimateNote: g.rangeInfo?.estimateNote ?? "" } : {}),
      }
    : undefined;
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));
  let kind: "new" | "update";
  let entry: Record<string, unknown>;
  if (base) {
    kind = "update";
    const { grindRanges: _r, rangeInfo: _i, ...rest } = base;
    entry = clean({ ...rest, version: base.version + 1, grindRanges: ranges ?? undefined, rangeInfo });
  } else {
    kind = "new";
    const id = slugify(g.brand && !g.name.toLowerCase().startsWith(g.brand.toLowerCase()) ? `${g.brand} ${g.name}` : g.name) || "gear";
    entry = clean({
      id, version: 1, name: g.name, brand: g.brand ?? null, type: g.type, category: g.category ?? undefined,
      details: g.details, units: g.type === "grinder" ? g.units : undefined, burrs: g.type === "grinder" ? g.burrs : undefined,
      variants: g.variants,
      defaultMethod: g.type === "brewer" ? g.defaultMethod : undefined, grindRanges: ranges ?? undefined, rangeInfo,
    });
    if (!("brand" in entry)) entry = { ...entry, brand: null };
    // Keep the library's key order (id, version, name, brand, …).
    entry = Object.fromEntries(["id", "version", "name", "brand", "type", "category", "details", "units", "burrs", "variants", "defaultMethod", "grindRanges", "rangeInfo"].filter((k) => k in entry).map((k) => [k, entry[k]]));
  }
  const id = String(entry.id);
  const issues: string[] = [];
  if (!g.category && !base) issues.push("Choose a Kind for this gear (Edit → Kind) — the library groups and matches recipes by it.");
  const parsed = CatalogGear.safeParse(entry);
  if (!parsed.success) for (const i of parsed.error.issues) issues.push(`${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`);
  if (kind === "new" && catalogGear(id)) issues.push(`The library already has "${id}" (${catalogGear(id)!.name}). Add that one from the library instead, and suggest changes to it.`);
  if (kind === "update" && !ranges) issues.push("Nothing to suggest yet: an update proposes this gear's grind ranges, and it has none.");
  const json = JSON.stringify(entry, null, 2) + "\n";
  const file = `catalog/gear/${id}.json`;
  const githubUrl =
    kind === "new"
      ? `https://github.com/${LIBRARY_REPO}/new/main/catalog/gear?filename=${encodeURIComponent(id + ".json")}&value=${encodeURIComponent(json)}`
      : `https://github.com/${LIBRARY_REPO}/edit/main/${file}`;
  return { kind, id, file, json, issues: [...new Set(issues)], githubUrl, repo: LIBRARY_REPO };
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
    espressoCapable: null, // retired: "can do" per method is grindRanges.unsupported
    variants: c.variants ? JSON.stringify(c.variants) : null,
    grindRanges: c.grindRanges ? JSON.stringify(c.grindRanges) : null,
    rangeInfo: rangeInfoFromCatalog(c) ? JSON.stringify(rangeInfoFromCatalog(c)) : null,
    defaultMethod: c.defaultMethod ?? null,
    catalogId: c.id,
    catalogVersion: c.version,
    category: c.category,
  };
}

/* ---------- water (catalog/water-additives.json + catalog/water/<id>.json) ---------- */

const ppm = z.number().min(0).max(100000).nullable();
const httpsUrl = z.string().regex(/^https:\/\/\S+$/, "must be a link starting with https://");
const WaterBaseSchema = z.object({ id: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1), gh: ppm, kh: ppm, note: z.string().optional() });
const AdditiveSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    kind: z.enum(["salt", "drops", "packet", "concentrate"]),
    formula: z.string().optional(),
    ref: z.object({
      amount: z.number().positive(), unit: z.enum(AMOUNT_UNITS), volume: z.number().positive(), volumeUnit: z.enum(VOLUME_UNITS),
      gh: ppm, kh: ppm, tds: z.number().min(0).nullable().optional(),
    }),
    basis: z.enum(["calculated", "published"]),
    source: httpsUrl.optional(),
    note: z.string().optional(),
  })
  .superRefine((a, ctx) => {
    // Published strengths need a cited source; calculated ones say how (molar mass) in the note.
    if (a.basis === "published" && !a.source) ctx.addIssue({ code: "custom", message: `${a.id}: a published strength needs a source link`, path: ["source"] });
    if (a.basis === "calculated" && !a.note) ctx.addIssue({ code: "custom", message: `${a.id}: say how the strength was calculated (note)`, path: ["note"] });
  });
export const WaterAdditivesSchema = z.object({
  about: z.string().optional(),
  version: z.number().int().positive(),
  bases: z.array(WaterBaseSchema),
  additives: z.array(AdditiveSchema),
});
export const WaterTemplate = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.number().int().positive(),
  name: z.string().min(1),
  credit: z.string().nullable().optional(),
  base: z.string(),
  volume: z.number().positive(),
  volumeUnit: z.enum(VOLUME_UNITS),
  additives: z.array(z.object({ additive: z.string(), amount: z.number().positive(), unit: z.enum(AMOUNT_UNITS) })).min(1),
  /** The source's own numbers (shown, and checked against what the additives add up to). */
  stated: z.object({ gh: z.number().min(0).optional(), kh: z.number().min(0).optional(), tds: z.number().min(0).optional() }).optional(),
  /** Every library water recipe cites where it comes from. */
  source: httpsUrl,
  notes: z.string().optional(),
});
export type WaterTemplateT = z.infer<typeof WaterTemplate>;

let waterCache: { bases: WaterBase[]; additives: WaterAdditive[]; recipes: WaterTemplateT[]; errors: string[] } | null = null;
export function loadWaterCatalog(dir = CATALOG_DIR, fresh = false) {
  if (waterCache && !fresh && dir === CATALOG_DIR) return waterCache;
  const errors: string[] = [];
  let bases: WaterBase[] = [];
  let additives: WaterAdditive[] = [];
  try {
    const p = WaterAdditivesSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, "water-additives.json"), "utf8")));
    if (p.success) ({ bases, additives } = p.data as { bases: WaterBase[]; additives: WaterAdditive[] });
    else errors.push(...p.error.issues.map((i) => `water-additives.json: ${i.path.join(".")}: ${i.message}`));
  } catch (e: any) {
    errors.push(`water-additives.json: ${e.message}`);
  }
  for (const [what, list] of [["base", bases], ["additive", additives]] as const) {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) errors.push(`water-additives.json: two ${what}s have the id "${x.id}"`);
      seen.add(x.id);
    }
  }
  const r = loadDir(path.join(dir, "water"), WaterTemplate);
  errors.push(...r.errors.map((e) => `water/${e}`));
  const recipes: WaterTemplateT[] = [];
  for (const t of r.items) {
    const where = `water/${t.id}.json`;
    let ok = true;
    if (!bases.some((b) => b.id === t.base)) { errors.push(`${where}: base "${t.base}" isn't in water-additives.json`); ok = false; }
    for (const l of t.additives) {
      const a = additives.find((x) => x.id === l.additive);
      if (!a) { errors.push(`${where}: additive "${l.additive}" isn't in water-additives.json`); ok = false; }
      else if (convertAmount(1, l.unit, a.ref.unit) == null) { errors.push(`${where}: ${a.name} is measured in ${a.ref.unit}, not ${l.unit}`); ok = false; }
    }
    if (ok) recipes.push(t);
  }
  const out = { bases, additives, recipes, errors };
  if (dir === CATALOG_DIR) waterCache = out;
  return out;
}
export const catalogWater = (id: string) => loadWaterCatalog().recipes.find((w) => w.id === id) ?? null;

/** A library water recipe as an editable copy's fields. */
export function waterFromTemplate(t: WaterTemplateT) {
  const c = loadWaterCatalog();
  const base = c.bases.find((b) => b.id === t.base);
  return {
    name: t.name, baseId: t.base, baseName: base?.name ?? t.base, baseGh: null, baseKh: null, volume: t.volume, volumeUnit: t.volumeUnit,
    additives: t.additives.map((l) => ({ additiveId: l.additive, name: c.additives.find((a) => a.id === l.additive)?.name ?? l.additive, amount: l.amount, unit: l.unit })) as WaterLine[],
    notes: [t.notes, t.credit ? `By ${t.credit}.` : null].filter(Boolean).join(" ") || null,
    source: t.source, catalogId: t.id, catalogVersion: t.version,
  };
}
