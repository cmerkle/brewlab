// Brew Log search and filters, on the shared facet engine (filters.ts). A brew is filtered together
// with its Stash bag (`bag`), so roaster, origin, roast level and process come from the bag.
import { METHOD_LABELS, type Method } from "./grind.js";
import { fold, localDay, matchesFilters, ratingValue, type DateDef, type FacetDef, type Filters } from "./filters.js";

export interface FilterBrew {
  brewedAt: string;
  recipeName: string | null;
  brewerName: string | null;
  grinderName: string | null;
  grindSetting?: number | string | null;
  method: string | null;
  coffee: string | null;
  waterName?: string | null;
  rating: number | null;
  notes: string | null;
  doseG: number | null;
  waterG: number | null;
  tempC?: number | null;
  inventoryId: number | null;
}
export interface FilterBag {
  id: number;
  name: string;
  roaster: string | null;
  origin: string | null;
  processMethod: string | null;
  roastLevel: string | null;
  tastingNotes?: string[];
}
export type BrewItem<T extends FilterBrew = FilterBrew> = T & { bag: FilterBag | null };

/** Pair each brew with its Stash bag (null if none, or the bag was deleted). */
export function withBags<T extends FilterBrew>(brews: T[], bags: Map<number, FilterBag>): BrewItem<T>[] {
  return brews.map((b) => ({ ...b, bag: b.inventoryId != null ? bags.get(b.inventoryId) ?? null : null }));
}

const methodLabel = (m: string | null) => (m ? METHOD_LABELS[m as Method] ?? m : null);

/** The facets, in the order the filter sheet shows them. */
export const BREW_FACETS: readonly FacetDef<BrewItem>[] = [
  { id: "coffee", label: "Coffee", get: (b) => b.bag?.name ?? b.coffee },
  { id: "roaster", label: "Roaster", get: (b) => b.bag?.roaster },
  { id: "origin", label: "Origin", get: (b) => b.bag?.origin },
  { id: "roastLevel", label: "Roast level", get: (b) => b.bag?.roastLevel },
  { id: "process", label: "Process", get: (b) => b.bag?.processMethod },
  { id: "recipe", label: "Recipe", get: (b) => b.recipeName },
  { id: "method", label: "Brew method", get: (b) => methodLabel(b.method) },
  { id: "brewer", label: "Brewer", get: (b) => b.brewerName },
  { id: "grinder", label: "Grinder", get: (b) => b.grinderName },
  { id: "water", label: "Water", get: (b) => b.waterName },
  { id: "rating", label: "Rating", get: (b) => ratingValue(b.rating), order: "number" },
];
export const BREW_DATES: readonly DateDef<BrewItem>[] = [{ id: "brewed", label: "Brewed", get: (b) => b.brewedAt }];

/** Every search word must appear in the brew: names, coffee and its bag, notes, grind, numbers, date. */
export function brewMatchesQuery(b: BrewItem, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const day = localDay(b.brewedAt);
  const month = new Date(day + "T12:00:00").toLocaleDateString("en-US", { month: "long" });
  const hay = fold([
    ...BREW_FACETS.map((f) => f.get(b)).flat(), b.coffee, b.notes, ...(b.bag?.tastingNotes ?? []),
    b.grindSetting != null ? String(b.grindSetting) : "", b.doseG != null ? `${b.doseG}g` : "", b.waterG != null ? `${b.waterG}g` : "",
    day, month,
  ].filter(Boolean).join(" \u0000 "));
  return words.every((w) => hay.includes(w));
}

export function filterBrews<T extends BrewItem>(items: T[], f: Filters, query: string): T[] {
  return items.filter((b) => matchesFilters<BrewItem>(b, BREW_FACETS, BREW_DATES, f) && brewMatchesQuery(b, query));
}
