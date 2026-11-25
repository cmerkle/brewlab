// Faceted filters (pure functions, shared so they can be unit-tested). Used by the Brew Log and the
// Stash / Archive. A facet reads one value (or several, like tags) from an item; the user picks
// values: any of them within a facet (OR), every facet together (AND). Date fields take a range of
// local days. The search is separate (each list has its own), but option counts include it.

/** Lower-case, accents folded ("Café" → "cafe"). */
export const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export interface FacetDef<T> {
  id: string;
  label: string;
  get: (x: T) => string | string[] | null | undefined;
  /** Option order: most items first (default), or by the number in the value (ratings: 5★ … ½★, then the rest). */
  order?: "count" | "number";
}
export interface DateDef<T> { id: string; label: string; get: (x: T) => string | null | undefined }

export interface Filters {
  picked: Record<string, string[]>;
  /** Per date field: local days, YYYY-MM-DD, inclusive. */
  dates: Record<string, { from?: string | null; to?: string | null }>;
}
export const NO_FILTERS: Filters = { picked: {}, dates: {} };

export const same = (a: string, b: string) => fold(a) === fold(b);
/** YYYY-MM-DD in local time (a plain date stays as it is). */
export const localDay = (iso: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** "4★", "3.5★" — or "Not rated". */
export const ratingValue = (r: number | null | undefined) => (r == null ? "Not rated" : `${Number.isInteger(r) ? r : r.toFixed(1)}★`);

const values = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);

/** How many filters are on: each picked value counts, and each date range once. */
export function activeCount(f: Filters): number {
  return Object.values(f.picked).reduce((n, v) => n + (v?.length ?? 0), 0) + Object.values(f.dates).filter((r) => r?.from || r?.to).length;
}

/** Facet picks and date ranges (not the search). `skip` leaves one facet out (for its own option counts). */
export function matchesFilters<T>(x: T, facets: readonly FacetDef<T>[], dates: readonly DateDef<T>[], f: Filters, skip?: string): boolean {
  for (const facet of facets) {
    if (facet.id === skip) continue;
    const want = f.picked[facet.id];
    if (!want?.length) continue;
    const have = values(facet.get(x));
    if (!have.some((v) => want.some((w) => same(w, v)))) return false;
  }
  for (const d of dates) {
    const r = f.dates[d.id];
    if (!r?.from && !r?.to) continue;
    const raw = d.get(x);
    if (!raw) return false; // a range asks for a date; items without one are left out
    const day = localDay(raw);
    if (r.from && day < r.from) return false;
    if (r.to && day > r.to) return false;
  }
  return true;
}

/**
 * The values a facet can take, with how many items each would show given the other filters and
 * the search (so a pick never leads to an empty list unexpectedly). Picked values always stay listed.
 */
export function facetOptions<T>(items: T[], facets: readonly FacetDef<T>[], dates: readonly DateDef<T>[], facetId: string, f: Filters, query: (x: T) => boolean): { value: string; count: number }[] {
  const def = facets.find((x) => x.id === facetId)!;
  const m = new Map<string, { value: string; count: number }>();
  for (const x of items) {
    const ok = matchesFilters(x, facets, dates, f, facetId) && query(x);
    for (const v of new Set(values(def.get(x)))) {
      const key = fold(v);
      const e = m.get(key) ?? { value: v, count: 0 };
      if (ok) e.count++;
      m.set(key, e);
    }
  }
  for (const v of f.picked[facetId] ?? []) if (!m.has(fold(v))) m.set(fold(v), { value: v, count: 0 });
  const picked = new Set((f.picked[facetId] ?? []).map(fold));
  const out = [...m.values()].filter((o) => o.count > 0 || picked.has(fold(o.value)));
  if (def.order === "number") return out.sort((a, b) => (parseFloat(b.value) || 0) - (parseFloat(a.value) || 0) || a.value.localeCompare(b.value));
  return out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Toggle one value of a facet. */
export function togglePick(f: Filters, facetId: string, value: string): Filters {
  const cur = f.picked[facetId] ?? [];
  const next = cur.some((v) => same(v, value)) ? cur.filter((v) => !same(v, value)) : [...cur, value];
  return { ...f, picked: { ...f.picked, [facetId]: next } };
}

export function setRange(f: Filters, dateId: string, from: string | null | undefined, to: string | null | undefined): Filters {
  return { ...f, dates: { ...f.dates, [dateId]: { from: from || null, to: to || null } } };
}

/**
 * Suggestions while typing: the ones where a word starts with what you typed (best first), none for an
 * empty box. Our own list, not a <datalist> (iOS pops a datalist's whole list open on an empty, focused box).
 */
export function tagMatches(text: string, suggestions: string[], taken: string[], limit = 6): string[] {
  const q = fold(text.trim());
  if (!q) return [];
  const have = new Set(taken.map(fold));
  const score = (s: string) => {
    const f = fold(s);
    if (have.has(f) || f === q) return -1;
    if (f.startsWith(q)) return 2;
    return f.split(/[\s\-/(]+/).some((w) => w.startsWith(q)) ? 1 : -1;
  };
  return suggestions.map((s) => ({ s, k: score(s) })).filter((x) => x.k > 0).sort((a, b) => b.k - a.k).slice(0, limit).map((x) => x.s);
}
