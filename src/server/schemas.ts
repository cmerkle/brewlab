import { CATEGORIES } from "./catalog.js";
import { z } from "zod";
import { METHODS, toGrindNumber } from "../shared/grind.js";
import { AMOUNT_UNITS, VOLUME_UNITS } from "../shared/water.js";

/** Numeric limits — the single source for server validation AND form inputs (served at /api/schema). */
export const LIMITS = {
  doseG: { min: 0.1, max: 500, step: 0.1 },
  waterG: { min: 1, max: 5000, step: 1 },
  tempC: { min: 0, max: 100, step: 1 },
  rating: { min: 0.5, max: 5, step: 0.5 },
  amountG: { min: 1, max: 10000, step: 1 },
  price: { min: 0, max: 10000, step: 0.01 },
  totalTimeSec: { min: 0, max: 36000, step: 1 },
  targetWaterG: { min: 0, max: 5000, step: 1 },
  atSec: { min: 0, max: 36000, step: 1 },
} as const;

type LimitKey = keyof typeof LIMITS;
/** Ratings go in half stars: 0.5, 1, 1.5 … 5. */
const ratingSchema = z.number().min(0.5, "Rating must be ½–5 stars").max(5, "Rating must be ½–5 stars").refine((x) => Number.isInteger(x * 2), "Ratings go in half stars (e.g. 3.5)");
const num = (k: LimitKey, label: string) =>
  z.number({ error: `${label} must be a number` })
    .min(LIMITS[k].min, `${label} must be at least ${LIMITS[k].min}`)
    .max(LIMITS[k].max, `${label} must be at most ${LIMITS[k].max}`);
const optNum = (k: LimitKey, label: string) => num(k, label).nullable().optional();
const str = (max = 2000) => z.string().max(max).nullable().optional();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

export const StepSchema = z.object({
  label: z.string().max(200),
  detail: str(500),
  targetWaterG: optNum("targetWaterG", "Step target"),
  atSec: optNum("atSec", "Step time"),
});

const method = z.enum(METHODS).nullable().optional();

/** A grind setting is a plain number (what you set on the grinder). Older clients may still send
    text like "72 clicks" — its number is used. */
const grind = z.preprocess(
  (x) => (x == null || x === "" ? null : (toGrindNumber(x) ?? x)),
  z.number({ error: "Grind setting must be a number" }).min(0, "Grind setting can't be negative").max(10000, "Grind setting must be at most 10000").nullable(),
).optional();

export const RecipeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  brewerId: str(100),
  brewerName: str(200),
  method,
  coffee: str(200),
  doseG: num("doseG", "Coffee dose"),
  waterG: num("waterG", "Water"),
  tempC: optNum("tempC", "Temperature"),
  grinderId: str(100),
  grinderName: str(200),
  grindSetting: grind,
  steps: z.array(StepSchema).max(50).default([]),
  notes: str(5000),
  favorite: z.boolean().optional(),
  inventoryId: z.number().int().nullable().optional(),
  waterId: z.number().int().nullable().optional(),
  waterName: str(200),
  /** The roast the recipe was written for (a roast level; null = the roast nudge's baseline). */
  roastLevel: str(100),
});

export const BrewSchema = z.object({
  recipeId: z.number().int().nullable().optional(),
  recipeName: str(200),
  brewerId: str(100),
  brewerName: str(200),
  method,
  coffee: str(200),
  doseG: num("doseG", "Coffee dose"),
  waterG: num("waterG", "Water"),
  tempC: optNum("tempC", "Temperature"),
  grinderId: str(100),
  grinderName: str(200),
  grindSetting: grind,
  steps: z.array(StepSchema).max(50).nullable().optional(),
  inventoryId: z.number().int().nullable().optional(),
  rating: ratingSchema.nullable().optional(),
  notes: str(5000),
  totalTimeSec: optNum("totalTimeSec", "Total time"),
  brewedAt: z.string().optional(),
  waterId: z.number().int().nullable().optional(),
  waterName: str(200),
});

const ppmIn = (label: string) =>
  z.number({ error: `${label} must be a number` }).min(0, `${label} can't be negative`).max(5000, `${label} must be at most 5000 ppm`).nullable().optional();
export const WaterLineSchema = z.object({
  additiveId: z.string().max(100).nullable().optional(),
  concentrateId: z.number().int().nullable().optional(),
  name: z.string().trim().min(1, "Each additive needs a name").max(200),
  amount: z.number({ error: "Additive amounts must be numbers" }).positive("Additive amounts must be more than 0").max(100000, "Additive amounts must be at most 100000"),
  unit: z.enum(AMOUNT_UNITS, { error: `Additive units are ${AMOUNT_UNITS.join(", ")}` }),
  gh: ppmIn("An additive's hardness"),
  kh: ppmIn("An additive's alkalinity"),
});
export const WaterSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  baseId: str(100),
  baseName: str(200),
  baseGh: ppmIn("The base water's hardness"),
  baseKh: ppmIn("The base water's alkalinity"),
  volume: z.number({ error: "Volume must be a number" }).positive("Volume must be more than 0").max(100000, "Volume must be at most 100000"),
  volumeUnit: z.enum(VOLUME_UNITS, { error: `Volume units are ${VOLUME_UNITS.join(", ")}` }),
  additives: z.array(WaterLineSchema).max(30).default([]),
  /** A stock solution: other water recipes add grams of it. */
  concentrate: z.boolean().optional(),
  notes: str(5000),
  source: z.string().trim().max(2000).refine((u) => u === "" || /^https?:\/\/\S+$/.test(u), "The source must be a link starting with https://").nullable().optional(),
});

export const InventorySchema = z.object({
  name: z.string().trim().min(1, "Coffee name is required").max(200),
  roaster: str(200),
  origin: str(200),
  processMethod: str(200),
  roastLevel: str(100),
  roastDate: date,
  purchaseDate: date,
  openedDate: date,
  finishedDate: date,
  amountG: optNum("amountG", "Bag size"),
  price: optNum("price", "Price"),
  url: z.string().max(2000).url("Link must be a full URL (https://…)").nullable().optional().or(z.literal("").transform(() => null)),
  rating: ratingSchema.nullable().optional(),
  notes: str(5000),
  source: z.enum(["manual", "Coffee Recommendations"]).optional(),
  photo: z.string().regex(/^\/uploads\/bag-[\w.-]+\.(jpg|png)$/, "Invalid photo reference").nullable().optional(),
  /** Tasting-note tags ("strawberry", "milk chocolate"). */
  tastingNotes: z.array(z.string().trim().min(1).max(60, "A tasting note can be at most 60 characters")).max(40).optional(),
});

/** Exactly a recommendation's fields. */
export const RecommendationSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    roaster: z.string().max(200).nullable().optional(),
    origin: z.string().max(200).nullable().optional(),
    processMethod: z.string().max(200).nullable().optional(),
    tastingNotes: z.string().max(1000).nullable().optional(),
    roastLevel: z.string().max(100).nullable().optional(),
    priceAmount: z.number().nullable().optional(),
    priceText: z.string().max(100).nullable().optional(),
    url: z.string().max(2000).nullable().optional(),
  })
  .strict();

const rangeVal = z.number().nullable().optional();
export const GrindRangesSchema = z
  .object({
    scale: z.string().max(300).optional(),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    step: z.number().positive().nullable().optional(),
    notation: z.enum(["decimal", "thirds"]).optional(),
    dialDivisor: z.number().positive().nullable().optional(),
    methods: z.partialRecord(z.enum(METHODS), z.object({ low: rangeVal, high: rangeVal })).default({}),
    notes: z.partialRecord(z.enum(METHODS), z.string().max(500)).optional(),
    unsupported: z.array(z.enum(METHODS)).max(METHODS.length).optional(),
  })
  .nullable()
  .optional();

export const GearSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  type: z.enum(["grinder", "brewer", "other"]),
  brand: str(200),
  details: str(2000),
  units: str(50),
  burrs: str(200),
  espressoCapable: z.boolean().nullable().optional(),
  variants: z.array(z.string().max(200)).max(20).nullable().optional(),
  grindRanges: GrindRangesSchema,
  defaultMethod: method,
  /** Where the grind ranges come from (shown and editable in the gear editor). Omit to keep it. */
  rangeInfo: z
    .object({
      confidence: z.enum(["manufacturer", "community"]).nullable().optional(),
      source: z.string().trim().max(2000).refine((u) => u === "" || /^https?:\/\/\S+$/.test(u), "The source must be a link starting with https://").nullable().optional(),
      note: z.string().max(2000).nullable().optional(),
      estimated: z.array(z.enum(METHODS)).max(20).optional(),
      estimateNote: z.string().max(2000).nullable().optional(),
    })
    .nullable()
    .optional(),
  /** Library category (cone dripper, hand grinder …) — lets recipe templates match custom gear. */
  category: z.enum(CATEGORIES).nullable().optional(),
});

export const TastingSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  roaster: str(200),
  origin: str(200),
  processMethod: str(200),
  verdict: z.enum(["loved", "liked", "not_for_me", "disliked"], { error: "Choose a verdict (loved, liked, not for me, disliked)" }),
  notes: str(2000),
});

export const AvoidSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  roaster: str(200),
  reason: str(2000),
  url: str(2000),
});

export const CandidateSchema = z.object({
  kind: z.enum(["pick", "wildcard"]).default("pick"),
  name: z.string().trim().min(1, "Name is required").max(200),
  roaster: z.string().trim().min(1, "Roaster is required").max(200),
  origin: str(200),
  processMethod: str(200),
  tastingNotes: str(1000),
  roastLevel: str(100),
  priceAmount: z.number().nullable().optional(),
  priceText: str(100),
  url: str(2000),
  whyFit: str(2000),
  brewTip: str(1000),
  funkRisk: str(500),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export function firstError(e: z.ZodError): string {
  const i = e.issues[0];
  if (!i) return "Invalid input";
  const where = i.path.length ? `${i.path.join(".")}: ` : "";
  // Our messages already name the field; only prefix zod's generic ones.
  return /must|required|Dates|Link|Rating|Choose|needs|can't|units are/.test(i.message) ? i.message : `${where}${i.message}`;
}
