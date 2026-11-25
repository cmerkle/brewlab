// Prometheus metrics (GET /metrics, text exposition format 0.0.4) for Grafana and friends.
// Off by default: Settings → Your data → Prometheus metrics (settings.metrics). Computed from the
// database on every scrape — a personal instance is small, so there's no caching or registry.
//
// Brew totals are counters (they only drop if you delete brews). Per-dimension metrics reuse the
// brew log's facets (src/shared/brewfilter.ts), so "roaster", "origin" … mean the same everywhere.
// Per-bag gauges cover bags not finished yet, so label sets stay bounded. Nothing here leaves the
// instance unless you point a scraper at it.
import fs from "node:fs";
import type express from "express";
import { type DB, DB_PATH, deriveStatus } from "./db.js";
import { getSettings } from "./settings.js";
import { listBackups } from "./backup.js";
import { loadVocab } from "./catalog.js";
import { llmConfig } from "./llm.js";
import { inventoryRow } from "./routes-brew.js";
import { VERSION } from "./about.js";
import { BREW_FACETS, withBags, type FilterBag, type FilterBrew } from "../shared/brewfilter.js";
import { restState } from "../shared/stash.js";

type Labels = Record<string, string | number | null | undefined>;
interface Family { name: string; help: string; type: "gauge" | "counter"; samples: { labels: Labels; value: number }[] }

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
const fmtNum = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : n > 0 ? "+Inf" : n < 0 ? "-Inf" : "NaN");
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const NONE = "none";

/** Prometheus text format: HELP and TYPE per family, then one line per sample. */
export function render(families: Family[]): string {
  const out: string[] = [];
  for (const f of families) {
    out.push(`# HELP ${f.name} ${f.help.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")}`, `# TYPE ${f.name} ${f.type}`);
    for (const s of f.samples) {
      const ls = Object.entries(s.labels).map(([k, v]) => `${k}="${esc(v == null || v === "" ? NONE : String(v))}"`);
      out.push(`${f.name}${ls.length ? `{${ls.join(",")}}` : ""} ${fmtNum(s.value)}`);
    }
  }
  return out.join("\n") + "\n";
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T12:00:00") - Date.parse(from + "T12:00:00")) / 86_400_000);
const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) / 1000 : NaN);

export function collect(db: DB, now = new Date()): Family[] {
  const fams: Family[] = [];
  const add = (name: string, help: string, type: Family["type"], samples: Family["samples"]) => fams.push({ name: `brewlab_${name}`, help, type, samples });
  const one = (name: string, help: string, value: number, type: Family["type"] = "gauge") => add(name, help, type, [{ labels: {}, value }]);
  const settings = getSettings(db);
  const today = localDay(now);

  add("info", "Brewlab is running; the version is a label.", "gauge", [{ labels: { version: VERSION }, value: 1 }]);

  /* ---------------- brews ---------------- */
  const brews = db.prepare("SELECT * FROM brews ORDER BY brewedAt").all() as (FilterBrew & { id: number; totalTimeSec: number | null; tempC: number | null })[];
  const bagRows = (db.prepare("SELECT * FROM inventory_items").all() as any[]).map((r) => inventoryRow(db, r));
  const bagMap = new Map<number, FilterBag>(bagRows.map((b) => [b.id, b]));
  const items = withBags(brews, bagMap);
  const grams = (list: FilterBrew[]) => list.reduce((a, b) => a + (b.doseG ?? 0), 0);
  const rated = brews.filter((b) => b.rating != null);

  one("brews_total", "Brews logged.", brews.length, "counter");
  one("coffee_used_grams_total", "Coffee brewed, in grams (sum of doses).", grams(brews), "counter");
  one("water_used_grams_total", "Water brewed with, in grams.", brews.reduce((a, b) => a + (b.waterG ?? 0), 0), "counter");
  one("brews_rated_total", "Brews with a rating.", rated.length, "counter");
  one("brew_rating_average", "Average brew rating (1–5) over every rated brew.", rated.length ? rated.reduce((a, b) => a + b.rating!, 0) / rated.length : NaN);
  const ratios = brews.filter((b) => b.doseG && b.waterG).map((b) => b.waterG! / b.doseG!);
  one("brew_ratio_average", "Average water-to-coffee ratio (16 means 1:16).", ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : NaN);
  add("brews_by_rating_total", "Brews by rating in half stars (\"none\" = not rated).", "counter",
    ["0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", NONE].map((r) => ({ labels: { rating: r }, value: brews.filter((b) => (b.rating == null ? NONE : String(b.rating)) === r).length })));

  // Windows by local day (TZ), so a dashboard has today / this week without needing history.
  const windows: [string, number][] = [["today", 1], ["7d", 7], ["30d", 30], ["90d", 90], ["365d", 365]];
  const since = (days: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1 - days); return d; };
  const inWindow = (days: number) => brews.filter((b) => new Date(b.brewedAt) >= since(days));
  add("brews_window", "Brews in the last N local days (today = since midnight).", "gauge", windows.map(([w, d]) => ({ labels: { window: w }, value: inWindow(d).length })));
  add("coffee_used_window_grams", "Coffee brewed in the last N local days, in grams.", "gauge", windows.map(([w, d]) => ({ labels: { window: w }, value: grams(inWindow(d)) })));

  const days = new Set(brews.map((b) => localDay(new Date(b.brewedAt))));
  let streak = 0;
  for (const d = new Date(now); ; d.setDate(d.getDate() - 1)) {
    const k = localDay(d);
    if (days.has(k)) streak++;
    else if (k !== today) break; // nothing yet today: the streak runs to yesterday
  }
  one("brewing_streak_days", "Consecutive days with a brew, up to today (or yesterday, if nothing yet today).", streak);

  const last = brews.at(-1);
  one("first_brew_timestamp_seconds", "When the first brew was logged (Unix time).", ts(brews[0]?.brewedAt));
  one("last_brew_timestamp_seconds", "When the latest brew was logged (Unix time).", ts(last?.brewedAt));
  one("last_brew_dose_grams", "Dose of the latest brew.", last?.doseG ?? NaN);
  one("last_brew_water_grams", "Water of the latest brew.", last?.waterG ?? NaN);
  one("last_brew_rating", "Rating of the latest brew (NaN if not rated).", last?.rating ?? NaN);
  one("last_brew_temperature_celsius", "Water temperature of the latest brew.", last?.tempC ?? NaN);
  one("last_brew_duration_seconds", "Total time of the latest brew.", last?.totalTimeSec ?? NaN);

  // One family per dimension: brews, grams and average rating. "none" = not recorded.
  for (const f of BREW_FACETS) {
    if (f.id === "rating") continue;
    const dim = snake(f.id);
    const g = new Map<string, { n: number; grams: number; rSum: number; rN: number }>();
    for (const b of items) {
      const got = f.get(b);
      const v = (Array.isArray(got) ? got[0] : got) || NONE;
      const e = g.get(v) ?? { n: 0, grams: 0, rSum: 0, rN: 0 };
      e.n++; e.grams += b.doseG ?? 0;
      if (b.rating != null) { e.rSum += b.rating; e.rN++; }
      g.set(v, e);
    }
    const rows = [...g.entries()];
    const word = f.label.toLowerCase();
    add(`brews_by_${dim}_total`, `Brews by ${word}.`, "counter", rows.map(([v, e]) => ({ labels: { [dim]: v }, value: e.n })));
    add(`coffee_used_by_${dim}_grams_total`, `Coffee brewed by ${word}, in grams.`, "counter", rows.map(([v, e]) => ({ labels: { [dim]: v }, value: e.grams })));
    add(`brew_rating_average_by_${dim}`, `Average brew rating by ${word} (rated brews only).`, "gauge", rows.filter(([, e]) => e.rN).map(([v, e]) => ({ labels: { [dim]: v }, value: e.rSum / e.rN })));
  }

  /* ---------------- brew history (labels, so a dashboard has the whole history from the first scrape) ---------------- */
  const month = (iso: string) => localDay(new Date(iso)).slice(0, 7);
  const tally = <K extends string>(list: FilterBrew[], key: (b: FilterBrew) => K | null, w: (b: FilterBrew) => number = () => 1) => {
    const m = new Map<K, number>();
    for (const b of list) { const k = key(b); if (k != null) m.set(k, (m.get(k) ?? 0) + w(b)); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  add("brews_by_month_total", "Brews per calendar month (local time), YYYY-MM.", "counter", tally(brews, (b) => month(b.brewedAt)).map(([k, v]) => ({ labels: { month: k }, value: v })));
  add("coffee_used_by_month_grams_total", "Coffee brewed per calendar month, in grams.", "counter", tally(brews, (b) => month(b.brewedAt), (b) => b.doseG ?? 0).map(([k, v]) => ({ labels: { month: k }, value: v })));
  add("brews_by_day_total", "Brews per local day over the last 400 days, YYYY-MM-DD.", "counter",
    tally(brews.filter((b) => new Date(b.brewedAt) >= since(400)), (b) => localDay(new Date(b.brewedAt))).map(([k, v]) => ({ labels: { day: k }, value: v })));
  const WD = ["1-Mon", "2-Tue", "3-Wed", "4-Thu", "5-Fri", "6-Sat", "7-Sun"];
  // A plain date (no time) can't be placed in an hour, so those brews are left out here.
  const timed = brews.filter((b) => b.brewedAt.length > 10);
  const wdh = new Map<string, number>();
  for (const b of timed) { const d = new Date(b.brewedAt); const k = `${WD[(d.getDay() + 6) % 7]}|${String(d.getHours()).padStart(2, "0")}`; wdh.set(k, (wdh.get(k) ?? 0) + 1); }
  add("brews_by_weekday_hour_total", "Brews by local weekday (1-Mon … 7-Sun) and hour (00–23).", "counter",
    WD.flatMap((w) => Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")).map((h) => ({ labels: { weekday: w, hour: h }, value: wdh.get(`${w}|${h}`) ?? 0 }))));
  const RATIO_BINS: [string, number, number][] = [["< 1:4", 0, 4], ["1:4–1:12", 4, 12.5], ["1:13", 12.5, 13.5], ["1:14", 13.5, 14.5], ["1:15", 14.5, 15.5], ["1:16", 15.5, 16.5], ["1:17", 16.5, 17.5], ["1:18", 17.5, 18.5], ["≥ 1:19", 18.5, Infinity]];
  add("brews_by_ratio_total", "Brews by water-to-coffee ratio, binned (espresso-like under 1:4).", "counter",
    RATIO_BINS.map(([label, lo, hi], i) => ({ labels: { ratio: label, order: String(i + 1) }, value: ratios.filter((r) => r >= lo && r < hi).length })));
  // Averages per brew method: dose, ratio, time, temperature.
  const byMethod = new Map<string, typeof brews>();
  for (const b of items) { const k = (BREW_FACETS.find((f) => f.id === "method")!.get(b) as string) || NONE; byMethod.set(k, [...(byMethod.get(k) ?? []), b]); }
  const avgBy = (name: string, help: string, pick: (b: (typeof brews)[number]) => number | null | undefined) =>
    add(name, help, "gauge", [...byMethod].flatMap(([m, list]) => { const v = list.map(pick).filter((x): x is number => x != null && Number.isFinite(x)); return v.length ? [{ labels: { method: m }, value: v.reduce((a, c) => a + c, 0) / v.length }] : []; }));
  avgBy("brew_dose_grams_average_by_method", "Average dose per brew method.", (b) => b.doseG);
  avgBy("brew_ratio_average_by_method", "Average water-to-coffee ratio per brew method.", (b) => (b.doseG && b.waterG ? b.waterG / b.doseG : null));
  avgBy("brew_duration_seconds_average_by_method", "Average total brew time per brew method (timed brews).", (b) => b.totalTimeSec);
  avgBy("brew_temperature_celsius_average_by_method", "Average water temperature per brew method.", (b) => b.tempC);
  // Days with at least one brew, and the longest run of consecutive days.
  const sortedDays = [...days].sort();
  let longest = 0, run = 0, prev = "";
  for (const d of sortedDays) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = d; }
  one("brewing_days_total", "Days with at least one brew.", days.size, "counter");
  one("brewing_streak_longest_days", "Longest run of consecutive days with a brew.", longest);

  /* ---------------- stash ---------------- */
  const status = (b: any) => deriveStatus(b);
  add("bags", "Bags by status.", "gauge", ["unopened", "open", "finished"].map((s) => ({ labels: { status: s }, value: bagRows.filter((b) => status(b) === s).length })));
  const active = bagRows.filter((b) => status(b) !== "finished");
  one("stash_remaining_grams", "Coffee left in open and unopened bags (bags with a size).", active.reduce((a, b) => a + Math.max(0, b.remainingG ?? 0), 0));
  one("spent_total", "Money spent on bags (sum of prices, in your currency).", bagRows.reduce((a, b) => a + (b.price ?? 0), 0), "counter");
  const spentBy = new Map<string, number>();
  for (const b of bagRows) if (b.price != null) spentBy.set(b.roaster || NONE, (spentBy.get(b.roaster || NONE) ?? 0) + b.price);
  add("spent_by_roaster_total", "Money spent on bags by roaster.", "counter", [...spentBy].map(([r, v]) => ({ labels: { roaster: r }, value: v })));
  const year = today.slice(0, 4);
  one("spent_this_year", "Money spent on bags bought this calendar year.", bagRows.filter((b) => b.purchaseDate?.startsWith(year)).reduce((a, b) => a + (b.price ?? 0), 0));
  // Purchase history: by month of the purchase date, and every bag ever (finished ones too) by what it was.
  const bMonth = new Map<string, { n: number; spent: number; grams: number }>();
  for (const b of bagRows) if (b.purchaseDate) { const k = b.purchaseDate.slice(0, 7); const e = bMonth.get(k) ?? { n: 0, spent: 0, grams: 0 }; e.n++; e.spent += b.price ?? 0; e.grams += b.amountG ?? 0; bMonth.set(k, e); }
  const bm = [...bMonth].sort((a, b) => a[0].localeCompare(b[0]));
  add("bags_bought_by_month_total", "Bags bought per month (purchase date), YYYY-MM.", "counter", bm.map(([k, e]) => ({ labels: { month: k }, value: e.n })));
  add("spent_by_month_total", "Money spent on bags per month (purchase date).", "counter", bm.map(([k, e]) => ({ labels: { month: k }, value: e.spent })));
  add("coffee_bought_by_month_grams_total", "Coffee bought per month (bag sizes), in grams.", "counter", bm.map(([k, e]) => ({ labels: { month: k }, value: e.grams })));
  for (const [dim, key] of [["roaster", "roaster"], ["origin", "origin"], ["roast_level", "roastLevel"], ["process", "processMethod"]] as const) {
    const m = new Map<string, { n: number; rSum: number; rN: number }>();
    for (const b of bagRows) { const k = b[key] || NONE; const e = m.get(k) ?? { n: 0, rSum: 0, rN: 0 }; e.n++; if (b.rating != null) { e.rSum += b.rating; e.rN++; } m.set(k, e); }
    add(`bags_by_${dim}_total`, `Every bag you've had, by ${dim.replace("_", " ")}.`, "counter", [...m].map(([k, e]) => ({ labels: { [dim]: k }, value: e.n })));
    add(`bag_rating_average_by_${dim}`, `Average bag rating by ${dim.replace("_", " ")} (rated bags).`, "gauge", [...m].filter(([, e]) => e.rN).map(([k, e]) => ({ labels: { [dim]: k }, value: e.rSum / e.rN })));
  }
  const noteCount = new Map<string, { label: string; n: number }>();
  for (const b of bagRows) for (const t of new Set<string>((b.tastingNotes ?? []).map((x: string) => x.trim()).filter(Boolean))) {
    const k = t.toLowerCase(); const e = noteCount.get(k) ?? { label: t, n: 0 }; e.n++; noteCount.set(k, e);
  }
  add("bags_by_tasting_note_total", "Bags with each tasting-note tag (every bag you've had).", "counter", [...noteCount.values()].map((e) => ({ labels: { note: e.label }, value: e.n })));
  // Prices and costs: per kg of bags with a price and a size; brewed coffee at its bag's price per gram.
  const priced = bagRows.filter((b) => b.price != null && b.amountG);
  one("coffee_price_per_kg_average", "Average price per kg over bags with a price and a size.", priced.length ? priced.reduce((a, b) => a + (b.price / b.amountG) * 1000, 0) / priced.length : NaN);
  const perGram = new Map<number, number>(priced.map((b) => [b.id, b.price / b.amountG]));
  const costed = brews.filter((b) => b.inventoryId != null && perGram.has(b.inventoryId) && b.doseG);
  const costOf = (b: FilterBrew) => perGram.get(b.inventoryId!)! * b.doseG!;
  one("coffee_brewed_cost_total", "Cost of the coffee brewed (dose × its bag's price per gram; brews from priced bags only).", costed.reduce((a, b) => a + costOf(b), 0), "counter");
  one("brew_cost_average", "Average coffee cost per brew (brews from priced bags).", costed.length ? costed.reduce((a, b) => a + costOf(b), 0) / costed.length : NaN);
  add("coffee_brewed_cost_by_month_total", "Cost of the coffee brewed per month.", "counter", tally(costed, (b) => month(b.brewedAt), costOf).map(([k, v]) => ({ labels: { month: k }, value: v })));
  // Finished bags: how long they lasted.
  const done = bagRows.filter((b) => b.finishedDate);
  const avgDays = (from: (b: any) => string | null) => { const v = done.map((b) => (from(b) ? daysBetween(from(b)!, b.finishedDate) : null)).filter((x): x is number => x != null && x >= 0); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : NaN; };
  one("bag_days_open_to_finish_average", "Average days from opening a bag to finishing it.", avgDays((b) => b.openedDate));
  one("bag_days_roast_to_finish_average", "Average days from roast date to finishing a bag.", avgDays((b) => b.roastDate));
  one("bag_days_bought_to_finish_average", "Average days from buying a bag to finishing it.", avgDays((b) => b.purchaseDate));

  const levels = loadVocab().vocab.roastLevels;
  const bagLabels = (b: any) => ({ id: b.id, name: b.name, roaster: b.roaster, origin: b.origin, roast_level: b.roastLevel, process: b.processMethod, status: status(b) });
  const per = (name: string, help: string, get: (b: any) => number | null | undefined) =>
    add(name, help, "gauge", active.filter((b) => get(b) != null).map((b) => ({ labels: bagLabels(b), value: get(b)! })));
  per("bag_remaining_grams", "Coffee left in a bag not finished yet.", (b) => b.remainingG);
  per("bag_size_grams", "A bag's size.", (b) => b.amountG);
  per("bag_used_grams", "Coffee brewed from a bag (logged brews).", (b) => b.usedG);
  per("bag_brews_total", "Brews from a bag.", (b) => brews.filter((x) => x.inventoryId === b.id).length);
  per("bag_price", "A bag's price (your currency).", (b) => b.price);
  per("bag_rating", "A bag's own rating (1–5).", (b) => b.rating);
  per("bag_days_off_roast", "Days since a bag's roast date.", (b) => (b.roastDate ? daysBetween(b.roastDate, today) : null));
  per("bag_days_open", "Days since a bag was opened.", (b) => (b.openedDate ? daysBetween(b.openedDate, today) : null));
  // Where a bag is in its rest window (More → Settings → Rest and peak window): 1 for its state.
  add("bag_freshness", "1 for a bag's state in its roast level's rest window: resting, peak or past.", "gauge",
    active.flatMap((b) => {
      const state = restState(b.roastDate, b.roastLevel, today, levels, settings.restWindows);
      return state ? [{ labels: { ...bagLabels(b), state }, value: 1 }] : [];
    }));

  /* ---------------- gear, recipes, water ---------------- */
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  add("gear_items", "Gear by type.", "gauge", ["grinder", "brewer", "other"].map((t) => ({ labels: { type: t }, value: count(`SELECT COUNT(*) n FROM gear_items WHERE type='${t}'`) })));
  add("recipes", "Recipes: your own and starter ones.", "gauge", [
    { labels: { kind: "own" }, value: count("SELECT COUNT(*) n FROM recipes WHERE starter=0") },
    { labels: { kind: "starter" }, value: count("SELECT COUNT(*) n FROM recipes WHERE starter=1") },
  ]);
  one("recipes_favorite", "Recipes starred as favourites.", count("SELECT COUNT(*) n FROM recipes WHERE favorite=1"));
  add("water_recipes", "Water recipes (concentrate = a stock other waters add).", "gauge", [
    { labels: { concentrate: "false" }, value: count("SELECT COUNT(*) n FROM water_recipes WHERE concentrate=0") },
    { labels: { concentrate: "true" }, value: count("SELECT COUNT(*) n FROM water_recipes WHERE concentrate=1") },
  ]);

  /* ---------------- discover ---------------- */
  one("discover_enabled", "1 if Discover is switched on.", settings.discoverEnabled ? 1 : 0);
  one("discover_editions", "Weekly board editions.", count("SELECT COUNT(*) n FROM board_editions"));
  add("discover_picks", "Board picks by status.", "gauge",
    (db.prepare("SELECT status, COUNT(*) n FROM picks GROUP BY status").all() as { status: string; n: number }[]).map((r) => ({ labels: { status: r.status }, value: r.n })));
  add("tastings", "Tasting log entries by verdict.", "gauge",
    (db.prepare("SELECT verdict, COUNT(*) n FROM tastings GROUP BY verdict").all() as { verdict: string; n: number }[]).map((r) => ({ labels: { verdict: r.verdict }, value: r.n })));
  one("avoids", "Coffees on the avoid list.", count("SELECT COUNT(*) n FROM avoids"));
  const rs = db.prepare("SELECT lastRunAt, lastStatus FROM refresh_state WHERE id=1").get() as { lastRunAt: string | null; lastStatus: string | null } | undefined;
  one("discover_last_refresh_timestamp_seconds", "When the board was last refreshed (Unix time).", ts(rs?.lastRunAt));
  add("discover_last_refresh_info", "1, with the last refresh's status as a label.", "gauge", rs?.lastStatus ? [{ labels: { status: rs.lastStatus }, value: 1 }] : []);

  /* ---------------- instance ---------------- */
  const backups = listBackups();
  one("backups", "Backup snapshots on disk.", backups.length);
  one("backups_bytes", "Size of all backup snapshots.", backups.reduce((a, b) => a + b.bytes, 0));
  one("last_backup_timestamp_seconds", "When the newest backup was made (Unix time).", ts(backups[0]?.createdAt));
  let dbBytes = NaN;
  try { dbBytes = fs.statSync(DB_PATH).size; } catch { /* in-memory test database */ }
  one("database_bytes", "Size of the SQLite database file.", dbBytes);
  one("ai_configured", "1 if an AI provider is set up.", llmConfig().enabled ? 1 : 0);
  return fams;
}

/** GET /metrics — only when switched on in Settings; 404 otherwise, like any unknown path. */
export function metricsHandler(db: DB): express.RequestHandler {
  return (_req, res) => {
    if (!getSettings(db).metrics) return res.status(404).type("text/plain").send("Metrics are off. Turn them on in Brewlab: More → Settings → Prometheus metrics.\n");
    res.type("text/plain; version=0.0.4; charset=utf-8").send(render(collect(db)));
  };
}
