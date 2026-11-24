import type { GrindRanges, Method } from "../shared/grind";
import type { Step } from "../shared/brew";
import type { Hardness, VolumeUnit, WaterAdditive, WaterBase, WaterLine } from "../shared/water";

export interface WaterRecipe {
  id: number;
  name: string;
  baseId: string | null;
  baseName: string | null;
  baseGh: number | null;
  baseKh: number | null;
  volume: number;
  volumeUnit: VolumeUnit;
  additives: WaterLine[];
  notes: string | null;
  source: string | null;
  catalogId: string | null;
  /** A stock solution other waters add by the gram (not brewed with directly). */
  concentrate: boolean;
  hardness: Hardness;
  usage: { recipes: number; brews: number; rated: number; avgRating: number | null };
}
export interface WaterTemplate {
  id: string;
  name: string;
  credit?: string | null;
  baseName: string;
  volume: number;
  volumeUnit: VolumeUnit;
  lines: WaterLine[];
  stated?: { gh?: number; kh?: number; tds?: number };
  source: string;
  notes?: string;
  owned: boolean;
  hardness: Hardness;
}
export interface WaterCatalog { bases: WaterBase[]; additives: WaterAdditive[]; recipes: WaterTemplate[]; errors: string[] }

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: any) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  return data as T;
}

export const api = {
  get: <T>(u: string) => req<T>("GET", u),
  post: <T>(u: string, b?: unknown) => req<T>("POST", u, b ?? {}),
  put: <T>(u: string, b: unknown) => req<T>("PUT", u, b),
  patch: <T>(u: string, b: unknown) => req<T>("PATCH", u, b),
  del: <T>(u: string) => req<T>("DELETE", u),
};

export interface Limit { min: number; max: number; step: number }
export type Limits = Record<"doseG" | "waterG" | "tempC" | "rating" | "amountG" | "price" | "totalTimeSec" | "targetWaterG" | "atSec", Limit>;

export interface RangeInfo {
  confidence?: "manufacturer" | "community" | null;
  source?: string | null;
  note?: string | null;
  /** Methods whose range is extrapolated, not from the source. */
  estimated?: Method[];
  estimateNote?: string | null;
}

export interface Gear {
  id: string;
  name: string;
  type: "grinder" | "brewer" | "other";
  brand: string | null;
  details: string | null;
  units: string | null;
  burrs: string | null;
  variants: string[] | null;
  grindRanges: GrindRanges | null;
  defaultMethod: Method | null;
  builtin: boolean;
  category: string | null;
  catalogId: string | null;
  /** Where the grind ranges come from — copied from the library on install, editable. */
  rangeInfo: RangeInfo | null;
  /** Library entry this gear was installed from (catalog/gear), if any. */
  library: {
    id: string; name?: string; missing?: boolean; installedVersion?: number | null; latestVersion?: number;
    confidence?: "manufacturer" | "community" | "drafted" | null; source?: string | null; note?: string | null;
    hasRanges?: boolean; rangesDiffer?: boolean;
  } | null;
}

export interface Recipe {
  id: number;
  name: string;
  brewerId: string | null;
  brewerName: string | null;
  method: Method | null;
  coffee: string | null;
  doseG: number;
  waterG: number;
  tempC: number | null;
  grinderId: string | null;
  grinderName: string | null;
  /** What you set on the grinder, as a plain number (units come from the grinder). */
  grindSetting: number | null;
  steps: Step[];
  notes: string | null;
  favorite: boolean;
  starter: boolean;
  inventoryId: number | null;
  /** Default water recipe (name kept if that water is deleted). */
  waterId: number | null;
  waterName: string | null;
}

export interface Brew {
  id: number;
  recipeId: number | null;
  recipeName: string | null;
  brewerId: string | null;
  brewerName: string | null;
  method: Method | null;
  coffee: string | null;
  doseG: number;
  waterG: number;
  tempC: number | null;
  grinderId: string | null;
  grinderName: string | null;
  /** What you set on the grinder, as a plain number (units come from the grinder). */
  grindSetting: number | null;
  steps: Step[] | null;
  inventoryId: number | null;
  rating: number | null;
  notes: string | null;
  totalTimeSec: number | null;
  brewedAt: string;
  /** The water recipe this brew used (name kept if that water is deleted). */
  waterId: number | null;
  waterName: string | null;
}

export interface Bag {
  id: number;
  name: string;
  roaster: string | null;
  origin: string | null;
  processMethod: string | null;
  roastLevel: string | null;
  roastDate: string | null;
  purchaseDate: string | null;
  openedDate: string | null;
  finishedDate: string | null;
  amountG: number | null;
  price: number | null;
  url: string | null;
  rating: number | null;
  notes: string | null;
  source: "manual" | "Coffee Recommendations";
  status: "unopened" | "open" | "finished";
  photo: string | null;
  usedG: number;
  remainingG: number | null;
}

export interface Pick {
  id: number;
  editionId: number;
  rank: number;
  kind: "pick" | "wildcard";
  name: string;
  roaster: string | null;
  origin: string | null;
  processMethod: string | null;
  tastingNotes: string | null;
  roastLevel: string | null;
  priceAmount: number | null;
  priceText: string | null;
  url: string | null;
  whyFit: string | null;
  brewTip: string | null;
  funkRisk: string | null;
  status: "new" | "saved" | "passed" | "tried";
  inventoryState: "not_added" | "adding" | "added";
}

export interface Edition { id: number; weekLabel: string; seasonNote: string | null; createdAt: string; picks: Pick[] }
export interface Tasting { id: number; name: string; roaster: string | null; origin: string | null; processMethod: string | null; verdict: string; notes: string | null; createdAt: string }
export interface Avoid { id: number; name: string; roaster: string | null; reason: string | null; url: string | null }
