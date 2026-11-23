import type { GrindRanges, Method } from "../shared/grind";
import type { Step } from "../shared/brew";

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

export interface Gear {
  id: string;
  name: string;
  type: "grinder" | "brewer" | "other";
  brand: string | null;
  details: string | null;
  units: string | null;
  burrs: string | null;
  espressoCapable: boolean | null;
  variants: string[] | null;
  grindRanges: GrindRanges | null;
  defaultMethod: Method | null;
  builtin: boolean;
  category: string | null;
  catalogId: string | null;
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
  grindSetting: string | null;
  steps: Step[];
  notes: string | null;
  favorite: boolean;
  starter: boolean;
  inventoryId: number | null;
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
  grindSetting: string | null;
  steps: Step[] | null;
  inventoryId: number | null;
  rating: number | null;
  notes: string | null;
  totalTimeSec: number | null;
  brewedAt: string;
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
