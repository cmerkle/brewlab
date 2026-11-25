// Insights: the numbers behind the dashboard (More → Insights). Pure functions over the brews and
// bags the app already has, so they're easy to test and the page needs no extra API.
// Days are local calendar days (the device's time zone).

export interface InsightBrew {
  brewedAt: string;
  doseG: number | null;
  waterG: number | null;
  rating: number | null;
  totalTimeSec?: number | null;
  brewerName: string | null;
  grinderName: string | null;
  recipeName: string | null;
  method: string | null;
  coffee: string | null;
  inventoryId: number | null;
  waterName?: string | null;
}
export interface InsightBag {
  id: number;
  name: string;
  roaster: string | null;
  origin: string | null;
  processMethod: string | null;
  roastLevel: string | null;
  purchaseDate: string | null;
  openedDate: string | null;
  finishedDate: string | null;
  price: number | null;
  amountG: number | null;
  status: string;
  createdAt?: string;
}

export const PERIODS = {
  "7d": { label: "7 days", short: "7d", days: 7 }, "30d": { label: "30 days", short: "30d", days: 30 }, "90d": { label: "90 days", short: "90d", days: 90 },
  "12m": { label: "12 months", short: "1y", days: 365 }, all: { label: "All time", short: "All", days: null },
} as const;
export type Period = keyof typeof PERIODS;
export type Unit = "day" | "week" | "month";

const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar day "YYYY-MM-DD". */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday of the week that holds d. */
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
/** A brew's date (a plain "YYYY-MM-DD" is that local day; a timestamp is local time). */
export const brewDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso));

/** [from, to) for a period ending today; "all" starts at the first brew (or today). */
export function periodRange(period: Period, now: Date, firstBrew?: Date | null): { from: Date; to: Date } {
  const to = addDays(startOfDay(now), 1);
  const days = PERIODS[period].days;
  if (days) return { from: addDays(to, -days), to };
  return { from: startOfDay(firstBrew && firstBrew < now ? firstBrew : now), to };
}
/** The same length just before (for "vs previous period"); none for all time. */
export function previousRange(period: Period, r: { from: Date; to: Date }): { from: Date; to: Date } | null {
  const days = PERIODS[period].days;
  return days ? { from: addDays(r.from, -days), to: r.from } : null;
}
export const inRange = <T extends { brewedAt: string }>(brews: T[], r: { from: Date; to: Date }) =>
  brews.filter((b) => { const d = brewDate(b.brewedAt); return d >= r.from && d < r.to; });

/** Day for up to a month, week up to ~4 months, else month. */
export function autoUnit(r: { from: Date; to: Date }): Unit {
  const days = Math.round((r.to.getTime() - r.from.getTime()) / DAY);
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
}

export interface Bucket { key: string; start: Date; label: string; brews: number; grams: number }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const bucketStart = (d: Date, u: Unit) => (u === "day" ? startOfDay(d) : u === "week" ? startOfWeek(d) : startOfMonth(d));
const nextBucket = (d: Date, u: Unit) => (u === "day" ? addDays(d, 1) : u === "week" ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1));
const bucketLabel = (d: Date, u: Unit) => (u === "month" ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}`);

/** Brews and grams per day / week / month across the range, empty buckets included. */
export function timeline(brews: InsightBrew[], r: { from: Date; to: Date }, unit: Unit): Bucket[] {
  const out: Bucket[] = [];
  const index = new Map<string, Bucket>();
  for (let d = bucketStart(r.from, unit); d < r.to; d = nextBucket(d, unit)) {
    const b = { key: dayKey(d), start: d, label: bucketLabel(d, unit), brews: 0, grams: 0 };
    out.push(b);
    index.set(b.key, b);
  }
  for (const br of inRange(brews, r)) {
    const b = index.get(dayKey(bucketStart(brewDate(br.brewedAt), unit)));
    if (!b) continue;
    b.brews++;
    b.grams += br.doseG ?? 0;
  }
  return out;
}

export interface Ranked {
  label: string;
  /** Items in the group. */
  count: number;
  /** What the group is ranked by: its count, or the sum of `weight` (e.g. grams of coffee). */
  value: number;
  /** Share of the total value. */
  share: number;
  avgRating: number | null;
  rated: number;
  other?: number;
}
/**
 * Group by a key, largest first — by count, or by the sum of `weight` when given (grams per grinder).
 * Missing keys are left out (and counted in `missing`). Past `limit` rows the tail folds into one
 * "Other" row (with how many groups it holds).
 */
export function rankBy<T>(items: T[], key: (x: T) => string | null | undefined, rating: (x: T) => number | null = () => null, limit = 8, weight?: (x: T) => number): { rows: Ranked[]; missing: number; total: number } {
  type Acc = { label: string; count: number; value: number; sum: number; rated: number };
  const m = new Map<string, Acc>();
  let missing = 0;
  for (const x of items) {
    const raw = key(x)?.trim();
    if (!raw) { missing++; continue; }
    const k = raw.toLowerCase();
    const e = m.get(k) ?? { label: raw, count: 0, value: 0, sum: 0, rated: 0 };
    e.count++;
    e.value += weight ? weight(x) || 0 : 1;
    const rt = rating(x);
    if (rt != null) { e.sum += rt; e.rated++; }
    m.set(k, e);
  }
  const all = [...m.values()].sort((a, b) => b.value - a.value || b.count - a.count || a.label.localeCompare(b.label));
  const total = all.reduce((a, e) => a + e.value, 0);
  const toRow = (e: Acc): Ranked => ({
    label: e.label, count: e.count, value: Math.round(e.value * 10) / 10, share: total ? e.value / total : 0,
    avgRating: e.rated ? Math.round((e.sum / e.rated) * 10) / 10 : null, rated: e.rated,
  });
  if (all.length <= limit) return { rows: all.map(toRow), missing, total };
  const head = all.slice(0, limit - 1).map(toRow);
  const tail = all.slice(limit - 1);
  const t = tail.reduce((a, e) => ({ label: "Other", count: a.count + e.count, value: a.value + e.value, sum: a.sum + e.sum, rated: a.rated + e.rated }), { label: "Other", count: 0, value: 0, sum: 0, rated: 0 });
  return { rows: [...head, { ...toRow(t), other: tail.length }], missing, total };
}

/** Average rating per group, best first — only groups with at least `minRated` rated items. */
export function bestRated<T>(items: T[], key: (x: T) => string | null | undefined, rating: (x: T) => number | null, minRated = 2, limit = 8): Ranked[] {
  return rankBy(items, key, rating, 1000).rows
    .filter((r) => r.rated >= minRated && r.avgRating != null)
    .sort((a, b) => b.avgRating! - a.avgRating! || b.rated - a.rated)
    .slice(0, limit);
}

/** When you brew: 7 weekdays (Mon first) × 8 three-hour bands. */
export const BANDS = ["0–3", "3–6", "6–9", "9–12", "12–15", "15–18", "18–21", "21–24"];
/** Column labels for the grid: the hour each 3-hour block starts. */
export const BAND_STARTS = ["0", "3", "6", "9", "12", "15", "18", "21"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function weekHours(brews: InsightBrew[]): number[][] {
  const grid = WEEKDAYS.map(() => BANDS.map(() => 0));
  for (const b of brews) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(b.brewedAt)) continue; // a date without a time can't be placed
    const d = new Date(b.brewedAt);
    grid[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 3)]++;
  }
  return grid;
}

/** Counts of 1–5★ brews. */
/**
 * Brews per rating: whole stars 1★–5★, or every half star (½★ … 5★) once any rating uses a half,
 * so a log without halves doesn't show five empty columns.
 */
export function ratingCounts(brews: InsightBrew[]): { label: string; stars: number; count: number }[] {
  const halves = brews.some((b) => b.rating != null && !Number.isInteger(b.rating));
  const steps = halves ? [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] : [1, 2, 3, 4, 5];
  const label = (s: number) => (s === 0.5 ? "½★" : `${Number.isInteger(s) ? s : s.toFixed(1)}★`);
  return steps.map((s) => ({ label: label(s), stars: s, count: brews.filter((b) => b.rating === s).length }));
}

/** Brew ratio (water ÷ coffee) in bins: <1:13, 1:13 … 1:18, ≥1:19, plus espresso-like (< 1:4). */
export const RATIO_BINS = ["< 1:4", "1:4–12", "1:13", "1:14", "1:15", "1:16", "1:17", "1:18", "≥ 1:19"];
export function ratioCounts(brews: InsightBrew[]): number[] {
  const out = RATIO_BINS.map(() => 0);
  for (const b of brews) {
    if (!b.doseG || !b.waterG) continue;
    const r = b.waterG / b.doseG;
    const i = r < 4 ? 0 : r < 12.5 ? 1 : r >= 18.5 ? 8 : Math.round(r) - 11;
    out[Math.min(8, Math.max(0, i))]++;
  }
  return out;
}

/** Days in a row with at least one brew, ending today (or yesterday, if nothing yet today). */
export function streak(brews: InsightBrew[], now: Date): number {
  const days = new Set(brews.map((b) => dayKey(brewDate(b.brewedAt))));
  let d = startOfDay(now);
  if (!days.has(dayKey(d))) d = addDays(d, -1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

export interface Kpis { brews: number; grams: number; avgRating: number | null; avgRatio: number | null; bagsFinished: number; spent: number | null; coffees: number }
const inDay = (iso: string | null, r: { from: Date; to: Date }) => { if (!iso) return false; const d = brewDate(iso); return d >= r.from && d < r.to; };
export function kpis(brews: InsightBrew[], bags: InsightBag[], r: { from: Date; to: Date }): Kpis {
  const bs = inRange(brews, r);
  const rated = bs.filter((b) => b.rating != null);
  const ratios = bs.filter((b) => b.doseG && b.waterG && b.waterG / b.doseG >= 4); // filter-style ratios only
  const bought = bags.filter((b) => b.price != null && inDay(b.purchaseDate, r));
  return {
    brews: bs.length,
    grams: Math.round(bs.reduce((a, b) => a + (b.doseG ?? 0), 0)),
    avgRating: rated.length ? Math.round((rated.reduce((a, b) => a + b.rating!, 0) / rated.length) * 10) / 10 : null,
    avgRatio: ratios.length ? Math.round((ratios.reduce((a, b) => a + b.waterG! / b.doseG!, 0) / ratios.length) * 10) / 10 : null,
    bagsFinished: bags.filter((b) => inDay(b.finishedDate, r)).length,
    spent: bought.length ? Math.round(bought.reduce((a, b) => a + b.price!, 0) * 100) / 100 : null,
    coffees: new Set(bs.map((b) => (b.inventoryId != null ? `bag:${b.inventoryId}` : (b.coffee ?? "").toLowerCase())).filter((x) => x && x !== "")).size,
  };
}

/** Coffee attributes of a brew, from its Stash bag (brews without a bag have none). */
export type CoffeeField = "roaster" | "origin" | "roastLevel" | "processMethod";
export const COFFEE_FIELDS: { field: CoffeeField; label: string }[] = [
  { field: "roaster", label: "Roasters" }, { field: "origin", label: "Origins" }, { field: "roastLevel", label: "Roast levels" }, { field: "processMethod", label: "Processes" },
];
export const brewBag = (b: InsightBrew, bags: Map<number, InsightBag>) => (b.inventoryId != null ? bags.get(b.inventoryId) ?? null : null);

/** Round axis ticks: 0 … a clean max (1, 2, 5 × 10ⁿ steps), about `n` of them. */
export function niceTicks(max: number, n = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export interface CumPoint { key: string; date: Date; label: string; day: number; total: number }
/**
 * A running total per day across the range: `events` add their value on their day (events outside
 * the range are ignored). The last point is the period's total.
 */
export function cumulative(events: { date: Date; value: number }[], r: { from: Date; to: Date }): CumPoint[] {
  const perDay = new Map<string, number>();
  for (const e of events) if (e.date >= r.from && e.date < r.to) perDay.set(dayKey(e.date), (perDay.get(dayKey(e.date)) ?? 0) + e.value);
  const out: CumPoint[] = [];
  let total = 0;
  for (let d = startOfDay(r.from); d < r.to; d = addDays(d, 1)) {
    const day = perDay.get(dayKey(d)) ?? 0;
    total = Math.round((total + day) * 100) / 100;
    out.push({ key: dayKey(d), date: d, label: `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : ""}`, day: Math.round(day * 100) / 100, total });
  }
  return out;
}
/** Grams of coffee per brew, on the brew's day. */
export const gramsEvents = (brews: InsightBrew[]) => brews.filter((b) => b.doseG).map((b) => ({ date: brewDate(b.brewedAt), value: b.doseG! }));
/** Bag prices on their purchase day (bags without both are left out, and counted). */
export function spendEvents(bags: InsightBag[]): { events: { date: Date; value: number }[]; skipped: number } {
  const ok = bags.filter((b) => b.price != null && b.purchaseDate);
  return { events: ok.map((b) => ({ date: brewDate(b.purchaseDate!), value: b.price! })), skipped: bags.length - ok.length };
}
