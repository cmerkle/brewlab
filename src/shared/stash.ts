// Stash sorting, search and filters (pure functions, shared so they can be unit-tested).
import { fold, ratingValue, type DateDef, type FacetDef } from "./filters.js";

export interface SortableBag {
  id: number;
  name: string;
  roaster: string | null;
  origin: string | null;
  processMethod: string | null;
  roastLevel: string | null;
  notes: string | null;
  roastDate: string | null;
  purchaseDate: string | null;
  openedDate: string | null;
  finishedDate: string | null;
  rating: number | null;
  price: number | null;
  remainingG: number | null;
  status: string;
  tastingNotes?: string[];
}

export const BAG_SORTS = {
  status: { label: "Default (open, then unopened)", kind: "status", dir: "asc" },
  name: { label: "Name", kind: "text", dir: "asc" },
  roaster: { label: "Roaster", kind: "text", dir: "asc" },
  origin: { label: "Origin", kind: "text", dir: "asc" },
  processMethod: { label: "Process", kind: "text", dir: "asc" },
  roastDate: { label: "Roast date", kind: "date", dir: "desc" },
  purchaseDate: { label: "Purchase date", kind: "date", dir: "desc" },
  openedDate: { label: "Opened date", kind: "date", dir: "desc" },
  finishedDate: { label: "Finished date", kind: "date", dir: "desc" },
  rating: { label: "Rating", kind: "number", dir: "desc" },
  price: { label: "Price", kind: "number", dir: "asc" },
  remainingG: { label: "Coffee left", kind: "number", dir: "desc" },
} as const;
export type BagSort = keyof typeof BAG_SORTS;
export type SortDir = "asc" | "desc";

export { fold } from "./filters.js";

const STATUS_RANK: Record<string, number> = { open: 0, unopened: 1, finished: 2 };

/**
 * Sort bags by a field in either direction. Bags missing that value always go last, whatever
 * the direction. Ties fall back to the Stash's own order (open first, most recent first).
 */
export function sortBags<T extends SortableBag>(bags: T[], by: BagSort, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const recent = (b: T) => b.openedDate ?? b.purchaseDate ?? "";
  const natural = (a: T, b: T) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || recent(b).localeCompare(recent(a)) || b.id - a.id;
  const kind = BAG_SORTS[by].kind;
  return [...bags].sort((a, b) => {
    if (kind === "status") return sign * natural(a, b) || 0;
    const va = (a as any)[by] as string | number | null;
    const vb = (b as any)[by] as string | number | null;
    const ma = va == null || va === "", mb = vb == null || vb === "";
    if (ma || mb) return ma && mb ? natural(a, b) : ma ? 1 : -1;
    const c = kind === "text" ? fold(String(va)).localeCompare(fold(String(vb))) : kind === "number" ? Number(va) - Number(vb) : String(va).localeCompare(String(vb));
    return sign * c || natural(a, b);
  });
}

/**
 * Every word must match somewhere: name, roaster, origin, process, roast level, notes, any date
 * (2026-11-04, "Nov 4, 2026", "november"), the rating ("4", "4★", "4 stars") or the price ("18", "$18").
 */
export function bagMatches(b: SortableBag, query: string, fmtDate: (d: string) => string = (d) => d): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const dates = [b.roastDate, b.purchaseDate, b.openedDate, b.finishedDate].filter(Boolean) as string[];
  const monthNames = dates.map((d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "long" }));
  const hay = fold([
    b.name, b.roaster, b.origin, b.processMethod, b.roastLevel, b.notes, ...(b.tastingNotes ?? []),
    ...dates, ...dates.map(fmtDate), ...monthNames,
    b.rating != null ? `${b.rating} ${b.rating}★ ${b.rating} stars` : "",
    b.price != null ? `${b.price} $${b.price}` : "",
  ].filter(Boolean).join(" \u0000 "));
  return words.every((w) => hay.includes(w));
}

/* ---------- roast levels and their rest / peak window (data + a setting) ---------- */

/** One roast level from catalog/coffee-vocab.json: rest = days to rest, peakEnd = last day at its best. */
export interface RoastLevelDef { id: string; label: string; aliases: string[]; rest: number; peakEnd: number; /** % of the method's grind range (negative = finer). */ grindShift?: number }
export interface RestWindow { rest: number; peakEnd: number }
/** Your own windows (More → Rest and peak window), by roast level id; missing ones use the data's. */
export type RestOverrides = Record<string, RestWindow>;

const squash = (s: string) => fold(s).replace(/[-_/]+/g, " ").replace(/\s+roast(ed)?$/, "").replace(/\s+/g, " ").trim();

/** The roast level a bag's text names exactly ("light-medium" → Medium-light), or null. */
export function roastLevelOf(text: string | null | undefined, levels: RoastLevelDef[]): RoastLevelDef | null {
  const t = squash(text ?? "");
  if (!t) return null;
  return levels.find((l) => squash(l.label) === t || l.aliases.some((a) => squash(a) === t)) ?? null;
}
/** Free text that isn't an exact level still gets a window: dark → Dark, light → Light, else Medium. */
export function nearestRoastLevel(text: string | null | undefined, levels: RoastLevelDef[]): RoastLevelDef | null {
  const exact = roastLevelOf(text, levels);
  if (exact) return exact;
  const t = squash(text ?? "");
  const id = /dark/.test(t) ? "dark" : /light/.test(t) ? "light" : "medium";
  return levels.find((l) => l.id === id) ?? null;
}

export function restWindowFor(text: string | null | undefined, levels: RoastLevelDef[], overrides: RestOverrides = {}): (RestWindow & { level: RoastLevelDef }) | null {
  const level = nearestRoastLevel(text, levels);
  if (!level) return null;
  const o = overrides[level.id];
  return { level, rest: o?.rest ?? level.rest, peakEnd: o?.peakEnd ?? level.peakEnd };
}

export function freshnessNote(daysOffRoast: number | null, roastLevel: string | null | undefined, levels: RoastLevelDef[], overrides: RestOverrides = {}): { text: string; tone: "info" | "ok" | "warn" } | null {
  const d = daysOffRoast;
  const w = restWindowFor(roastLevel, levels, overrides);
  if (d == null || d < 0 || !w) return null;
  const which = roastLevel?.trim() ? ` for a ${w.level.label.toLowerCase()} roast` : "";
  if (d < w.rest) return { text: `Day ${d} off roast — resting; usually best from about day ${w.rest}${which}`, tone: "info" };
  if (d <= w.peakEnd) return { text: `Day ${d} off roast — in its peak window${which}`, tone: "ok" };
  return { text: `Day ${d} off roast — past the usual peak window${which} (day ${w.peakEnd})`, tone: "warn" };
}

/** Split "strawberry, citrus · milk chocolate and honey" into tags. */
export function splitTags(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const t of (text ?? "").split(/,|;|·|\/|\band\b|&|\n/i)) {
    const tag = t.trim().replace(/\.$/, "").toLowerCase();
    if (tag && tag.length <= 60 && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 40);
}

/* ------------------------------ Stash / Archive filters (on the shared facet engine) ------------------------------ */

/** Where a bag is in its roast level's rest window today: resting, peak, past — null without a roast date. */
export type RestState = "resting" | "peak" | "past";
export function restState(roastDate: string | null | undefined, roastLevel: string | null | undefined, today: string, levels: RoastLevelDef[], overrides: RestOverrides = {}): RestState | null {
  const w = restWindowFor(roastLevel, levels, overrides);
  if (!roastDate || !w) return null;
  const d = Math.round((Date.parse(today + "T12:00:00") - Date.parse(roastDate + "T12:00:00")) / 86_400_000);
  if (d < 0) return null;
  return d < w.rest ? "resting" : d <= w.peakEnd ? "peak" : "past";
}
export const REST_STATE_LABELS: Record<RestState, string> = { resting: "Resting", peak: "In its peak window", past: "Past its peak" };

/** A bag as the filters see it: `rest` is filled in by the caller (it depends on today and your settings). */
export type FilterableBag = SortableBag & { rest?: RestState | null };
const STATUS_LABELS: Record<string, string> = { open: "Open", unopened: "Unopened", finished: "Finished" };

export const BAG_FACETS: readonly FacetDef<FilterableBag>[] = [
  { id: "status", label: "Status", get: (b) => STATUS_LABELS[b.status] ?? b.status },
  { id: "rest", label: "Rest window", get: (b) => (b.rest ? REST_STATE_LABELS[b.rest] : null) },
  { id: "roaster", label: "Roaster", get: (b) => b.roaster },
  { id: "origin", label: "Origin", get: (b) => b.origin },
  { id: "roastLevel", label: "Roast level", get: (b) => b.roastLevel },
  { id: "process", label: "Process", get: (b) => b.processMethod },
  { id: "notes", label: "Tasting notes", get: (b) => b.tastingNotes ?? [] },
  { id: "rating", label: "Rating", get: (b) => ratingValue(b.rating), order: "number" },
];
export const BAG_DATES: readonly DateDef<FilterableBag>[] = [
  { id: "roasted", label: "Roasted", get: (b) => b.roastDate },
  { id: "bought", label: "Bought", get: (b) => b.purchaseDate },
  { id: "opened", label: "Opened", get: (b) => b.openedDate },
  { id: "finished", label: "Finished", get: (b) => b.finishedDate },
];
