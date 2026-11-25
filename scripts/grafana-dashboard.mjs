#!/usr/bin/env node
// Builds grafana/brewlab-dashboard.json — the Grafana dashboard for Brewlab's /metrics.
//   node scripts/grafana-dashboard.mjs        (rewrites the JSON; commit both)
// Panels read history-shaped metrics (by month / day / weekday × hour, labels) so the dashboard is
// full from the first scrape, and trend panels over the gauges Prometheus has been collecting.
// tests/grafana.test.mjs checks every metric used here exists in the app's output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "grafana", "brewlab-dashboard.json");
const DS = { type: "prometheus", uid: "${datasource}" };
const J = 'job=~"$job"';
/** brewlab_<name>{job=~"$job", …} */
const m = (name, sel = "") => `brewlab_${name}{${J}${sel ? `, ${sel}` : ""}}`;

let id = 0, y = 0, x = 0, rowH = 0;
const panels = [];
/** Lay panels out left to right, wrapping at 24 columns. */
function place(w, h) {
  if (x + w > 24) { y += rowH; x = 0; rowH = 0; }
  const g = { x, y, w, h };
  x += w; rowH = Math.max(rowH, h);
  return g;
}
function row(title) {
  if (x > 0) { y += rowH; x = 0; rowH = 0; }
  panels.push({ type: "row", id: ++id, title, collapsed: false, gridPos: { x: 0, y, w: 24, h: 1 }, panels: [] });
  y += 1;
}
const target = (expr, o = {}) => ({ datasource: DS, expr, refId: o.refId ?? "A", legendFormat: o.legend ?? "__auto", instant: o.instant ?? false, range: !(o.instant ?? false), format: o.format ?? "time_series", ...(o.interval ? { interval: o.interval } : {}) });
const base = (type, title, w, h, targets, o = {}) => {
  const p = { type, id: ++id, title, description: o.description ?? "", datasource: DS, gridPos: place(w, h), targets: targets.map((t, i) => ({ ...t, refId: String.fromCharCode(65 + i) })),
    fieldConfig: { defaults: { unit: o.unit ?? "none", decimals: o.decimals, color: o.color ?? { mode: "palette-classic" }, ...(o.min != null ? { min: o.min } : {}), ...(o.max != null ? { max: o.max } : {}),
      thresholds: o.thresholds ?? { mode: "absolute", steps: [{ color: "#cf7f3e", value: null }] }, custom: o.custom ?? {}, mappings: o.mappings ?? [] }, overrides: o.overrides ?? [] },
    options: o.options ?? {}, transformations: o.transformations ?? [] };
  if (o.decimals == null) delete p.fieldConfig.defaults.decimals;
  panels.push(p);
  return p;
};
const ACCENT = { mode: "fixed", fixedColor: "#cf7f3e" };

/* ---------- panel kinds ---------- */
const stat = (title, expr, o = {}) => base("stat", title, o.w ?? 3, o.h ?? 4, [target(expr, { instant: true, format: o.format })], {
  ...o, color: o.color ?? ACCENT,
  options: { reduceOptions: { calcs: ["lastNotNull"], fields: o.fields ?? "", values: false }, colorMode: o.colorMode ?? "value", graphMode: o.graphMode ?? "none", textMode: o.textMode ?? "value", justifyMode: "center", orientation: "auto", wideLayout: true, showPercentChange: false },
});
/** Ranked bars from one labelled metric: largest first. */
const ranked = (title, expr, label, o = {}) => base("bargauge", title, o.w ?? 8, o.h ?? 9, [target(`sort_desc(${o.top ? `topk(${o.top}, ${expr})` : expr})`, { instant: true, legend: `{{${label}}}` })], {
  ...o, color: o.color ?? { mode: "continuous-YlRd" }, min: 0,
  options: { orientation: "horizontal", displayMode: "gradient", valueMode: "color", showUnfilled: true, sizing: "manual", minVizHeight: 16, maxVizHeight: 22, namePlacement: "left", reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false }, legend: { showLegend: false } },
});
/** Bars along a label (month, day, rating …), from an instant table query. */
const bars = (title, targets, xField, o = {}) => base("barchart", title, o.w ?? 12, o.h ?? 8, targets.map((t) => ({ ...target(t.expr, { instant: true, format: "table" }) })), {
  ...o, color: o.color ?? ACCENT,
  custom: { fillOpacity: 85, gradientMode: "none", lineWidth: 0, axisPlacement: "auto", axisSoftMin: 0 },
  options: { xField, orientation: "vertical", barWidth: 0.8, groupWidth: 0.75, showValue: o.showValue ?? "auto", stacking: "none", xTickLabelRotation: o.rotate ?? 0, xTickLabelSpacing: o.spacing ?? 0,
    legend: { showLegend: targets.length > 1, displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "none" } },
  transformations: [
    ...(targets.length > 1 ? [{ id: "organize", options: { excludeByName: { Time: true, __name__: true } } }, { id: "merge", options: {} }] : []),
    ...(o.toTime ? [{ id: "convertFieldType", options: { conversions: [{ targetField: xField, destinationType: "time", dateFormat: o.toTime }], fields: {} } }] : []),
    { id: "organize", options: { excludeByName: { Time: true, __name__: true, job: true, instance: true, order: true }, renameByName: o.rename ?? {} } },
    ...(o.sortBy ? [{ id: "sortBy", options: { sort: [{ field: o.sortBy, desc: false }] } }] : []),
  ],
});
const series = (title, targets, o = {}) => base("timeseries", title, o.w ?? 12, o.h ?? 8, targets.map((t) => target(t.expr, { legend: t.legend, interval: t.interval })), {
  ...o, color: o.color ?? { mode: "palette-classic" },
  custom: { drawStyle: o.draw ?? "line", lineWidth: 2, fillOpacity: o.fill ?? 12, gradientMode: "opacity", showPoints: "never", spanNulls: true, lineInterpolation: o.interp ?? "smooth", axisSoftMin: 0, stacking: { mode: "none" } },
  options: { legend: { showLegend: true, displayMode: o.legendMode ?? "list", placement: "bottom", calcs: o.calcs ?? [] }, tooltip: { mode: "multi", sort: "desc" } },
});
const pie = (title, expr, label, o = {}) => base("piechart", title, o.w ?? 6, o.h ?? 9, [target(expr, { instant: true, legend: `{{${label}}}` })], {
  ...o, options: { pieType: "donut", reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false }, legend: { showLegend: true, displayMode: "table", placement: "right", values: ["value", "percent"] }, tooltip: { mode: "single" }, displayLabels: [] },
});
/** A table from several instant queries joined on their labels. */
const table = (title, targets, o = {}) => base("table", title, o.w ?? 24, o.h ?? 10, targets.map((t) => target(t.expr, { instant: true, format: "table" })), {
  ...o, color: o.color ?? { mode: "thresholds" },
  custom: { align: "auto", cellOptions: { type: "auto" }, inspect: false, filterable: true },
  options: { showHeader: true, cellHeight: "sm", footer: { show: false }, sortBy: o.sort ? [{ displayName: o.sort, desc: o.sortDesc ?? true }] : [] },
  transformations: [
    // Instant queries can carry different timestamps; drop Time from each frame so rows join on labels alone.
    { id: "organize", options: { excludeByName: { Time: true, __name__: true } } },
    { id: "merge", options: {} },
    { id: "organize", options: { excludeByName: { Time: true, __name__: true, job: true, instance: true, ...(o.hide ?? {}) }, renameByName: o.rename ?? {}, indexByName: o.order ?? {} } },
  ],
});

/* =====================================================================================
   Panels
   ===================================================================================== */
const DIMS = [["roaster", "Roaster"], ["origin", "Origin"], ["roast_level", "Roast level"], ["process", "Process"]];
const GEAR = [["brewer", "Brewer"], ["grinder", "Grinder"], ["method", "Brew method"]];
const notNone = (l) => `${l}!="none"`;

row("At a glance");
stat("Brews today", m("brews_window", 'window="today"'), { description: "Since local midnight (the instance's TZ)." });
stat("Coffee today", m("coffee_used_window_grams", 'window="today"'), { unit: "massg" });
stat("Brews, last 7 days", m("brews_window", 'window="7d"'));
stat("Coffee, last 30 days", m("coffee_used_window_grams", 'window="30d"'), { unit: "massg" });
stat("Brewing streak", m("brewing_streak_days"), { unit: "d", description: "Consecutive days with a brew, up to today (or yesterday if nothing yet today)." });
stat("Longest streak", m("brewing_streak_longest_days"), { unit: "d" });
stat("Average rating", m("brew_rating_average"), { decimals: 2, unit: "none", description: "Every rated brew, in stars (½–5).", thresholds: { mode: "absolute", steps: [{ color: "#a85a22", value: null }, { color: "#cf7f3e", value: 3 }, { color: "#e0b050", value: 4 }] }, color: { mode: "thresholds" } });
stat("Average ratio (1:x)", m("brew_ratio_average"), { decimals: 1 });
stat("Brews, all time", m("brews_total"));
stat("Coffee, all time", m("coffee_used_grams_total"), { unit: "massg" });
stat("Water, all time", m("water_used_grams_total"), { unit: "massg" });
stat("Brewing days", m("brewing_days_total"), { unit: "none", description: "Days with at least one brew." });
stat("Last brew", `${m("last_brew_timestamp_seconds")} * 1000`, { unit: "dateTimeFromNow" });
stat("Coffee left in the stash", m("stash_remaining_grams"), { unit: "massg" });
stat("Spent this year", m("spent_this_year"), { unit: "currencyUSD", decimals: 0 });
stat("Average cost per brew", m("brew_cost_average"), { unit: "currencyUSD", decimals: 2, description: "Dose × the bag's price per gram, for brews from priced bags." });

row("Brewing over time");
bars("Brews per day (last 400 days)", [{ expr: m("brews_by_day_total") }], "day", { w: 24, h: 8, toTime: "YYYY-MM-DD", showValue: "never", spacing: 120, rename: { Value: "Brews" }, description: "From the app's history, so it's full from the first scrape." });
bars("Brews per month", [{ expr: m("brews_by_month_total") }], "month", { rename: { Value: "Brews" } });
bars("Coffee used per month", [{ expr: m("coffee_used_by_month_grams_total") }], "month", { unit: "massg", rename: { Value: "Coffee" } });
series("Brews in rolling windows", [{ expr: m("brews_window", 'window=~"7d|30d"'), legend: "last {{window}}" }], { description: "How the 7- and 30-day counts move, from what Prometheus has scraped." });
series("Coffee used in rolling windows", [{ expr: m("coffee_used_window_grams", 'window=~"7d|30d"'), legend: "last {{window}}" }], { unit: "massg" });
series("Brews per day (scraped)", [{ expr: `sum(increase(${m("brews_total")}[1d]))`, legend: "brews", interval: "1d" }], { draw: "bars", fill: 80, interp: "linear", description: "Daily increase of the brew counter since Prometheus started scraping (deleting brews shows as a dip)." });
series("Average rating over time", [{ expr: m("brew_rating_average"), legend: "all brews" }], { decimals: 2, min: 0, max: 5 });

row("The latest brew");
stat("Dose", m("last_brew_dose_grams"), { unit: "massg", w: 4 });
stat("Water", m("last_brew_water_grams"), { unit: "massg", w: 4 });
stat("Ratio (1:x)", `${m("last_brew_water_grams")} / ${m("last_brew_dose_grams")}`, { decimals: 1, w: 4 });
stat("Rating", m("last_brew_rating"), { decimals: 1, w: 4 });
stat("Temperature", m("last_brew_temperature_celsius"), { unit: "celsius", w: 4 });
stat("Brew time", m("last_brew_duration_seconds"), { unit: "s", w: 4 });

row("When you brew");
base("table", "Weekday × hour", 24, 9, [target(m("brews_by_weekday_hour_total"), { instant: true, format: "table" })], {
  description: "Brews by local weekday and hour of day — the darker, the more.",
  color: { mode: "continuous-YlRd" }, unit: "none",
  custom: { align: "center", cellOptions: { type: "color-background", mode: "gradient" }, inspect: false, width: 44 },
  options: { showHeader: true, cellHeight: "sm", footer: { show: false } },
  transformations: [
    { id: "groupingToMatrix", options: { columnField: "hour", rowField: "weekday", valueField: "Value", emptyValue: "zero" } },
    { id: "sortBy", options: { sort: [{ field: "weekday\\hour", desc: false }] } },
  ],
  overrides: [{ matcher: { id: "byName", options: "weekday\\hour" }, properties: [{ id: "displayName", value: "Day" }, { id: "custom.cellOptions", value: { type: "auto" } }, { id: "custom.width", value: 70 }] }],
});
bars("By hour of day", [{ expr: `sum by (hour) (${m("brews_by_weekday_hour_total")})` }], "hour", { sortBy: "hour", rename: { Value: "Brews" } });
bars("By weekday", [{ expr: `sum by (weekday) (${m("brews_by_weekday_hour_total")})` }], "weekday", { sortBy: "weekday", rename: { Value: "Brews" } });

row("Ratings and ratios");
// "3.5★" for the axis (a bare "3.5" would be read as a number); sorted by the numeric label.
bars("Brew ratings (half stars)", [{ expr: `label_replace(${m("brews_by_rating_total", notNone("rating"))}, "stars", "$1★", "rating", "(.*)")` }], "stars", { w: 8, sortBy: "rating", rename: { Value: "Brews" } });
bars("Brew ratios", [{ expr: m("brews_by_ratio_total") }], "ratio", { w: 8, rename: { Value: "Brews" }, description: "Water to coffee; under 1:4 is espresso-like." });
stat("Rated brews", m("brews_rated_total"), { w: 4, h: 8 });
stat("Not rated", m("brews_by_rating_total", 'rating="none"'), { w: 4, h: 8 });

row("Gear");
for (const [d, label] of GEAR) ranked(`Brews by ${label.toLowerCase()}`, m(`brews_by_${d}_total`), d);
for (const [d, label] of GEAR) ranked(`Coffee used by ${label.toLowerCase()}`, m(`coffee_used_by_${d}_grams_total`), d, { unit: "massg" });
for (const [d, label] of GEAR) ranked(`Average rating by ${label.toLowerCase()}`, m(`brew_rating_average_by_${d}`), d, { decimals: 2, max: 5 });
table("Brew method averages", [
  { expr: m("brew_dose_grams_average_by_method") }, { expr: m("brew_ratio_average_by_method") },
  { expr: m("brew_duration_seconds_average_by_method") }, { expr: m("brew_temperature_celsius_average_by_method") }, { expr: m("brews_by_method_total") },
], { h: 8, sort: "Brews", rename: { method: "Method", "Value #A": "Dose (g)", "Value #B": "Ratio (1:x)", "Value #C": "Time", "Value #D": "Temp", "Value #E": "Brews" },
  overrides: [
    { matcher: { id: "byName", options: "Dose (g)" }, properties: [{ id: "decimals", value: 1 }] },
    { matcher: { id: "byName", options: "Ratio (1:x)" }, properties: [{ id: "decimals", value: 1 }] },
    { matcher: { id: "byName", options: "Time" }, properties: [{ id: "unit", value: "s" }] },
    { matcher: { id: "byName", options: "Temp" }, properties: [{ id: "unit", value: "celsius" }, { id: "decimals", value: 0 }] },
  ] });
stat("Grinders", m("gear_items", 'type="grinder"'), { w: 4 });
stat("Brewers", m("gear_items", 'type="brewer"'), { w: 4 });
stat("Your recipes", m("recipes", 'kind="own"'), { w: 4 });
stat("Starter recipes", m("recipes", 'kind="starter"'), { w: 4 });
stat("Favourite recipes", m("recipes_favorite"), { w: 4 });
stat("Water recipes", `sum(${m("water_recipes")})`, { w: 4 });

row("Recipes and water");
ranked("Brews by recipe", m("brews_by_recipe_total"), "recipe", { w: 12, h: 11, top: 20 });
ranked("Coffee used by recipe", m("coffee_used_by_recipe_grams_total"), "recipe", { w: 12, h: 11, top: 20, unit: "massg" });
ranked("Average rating by recipe", m("brew_rating_average_by_recipe"), "recipe", { w: 12, h: 11, top: 20, decimals: 2, max: 5 });
ranked("Brews by water", m("brews_by_water_total"), "water", { w: 6, h: 11 });
ranked("Average rating by water", m("brew_rating_average_by_water"), "water", { w: 6, h: 11, decimals: 2, max: 5 });

row("Your coffee: what you brew and how you rate it");
for (const [d, label] of DIMS) ranked(`Brews by ${label.toLowerCase()}`, m(`brews_by_${d}_total`), d, { w: 6, top: 15 });
for (const [d, label] of DIMS) ranked(`Coffee used by ${label.toLowerCase()}`, m(`coffee_used_by_${d}_grams_total`), d, { w: 6, top: 15, unit: "massg" });
for (const [d, label] of DIMS) ranked(`Average brew rating by ${label.toLowerCase()}`, m(`brew_rating_average_by_${d}`), d, { w: 6, top: 15, decimals: 2, max: 5 });
ranked("Most-brewed coffees", m("brews_by_coffee_total"), "coffee", { w: 12, h: 12, top: 20 });
ranked("Best-rated coffees (brews)", m("brew_rating_average_by_coffee"), "coffee", { w: 12, h: 12, top: 20, decimals: 2, max: 5 });

row("Your coffee: every bag you've had");
for (const [d, label] of DIMS) pie(`Bags by ${label.toLowerCase()}`, m(`bags_by_${d}_total`), d);
for (const [d, label] of DIMS) ranked(`Average bag rating by ${label.toLowerCase()}`, m(`bag_rating_average_by_${d}`), d, { w: 6, top: 15, decimals: 2, max: 5 });
ranked("Tasting notes on your bags", m("bags_by_tasting_note_total"), "note", { w: 24, h: 12, top: 30, description: "How many bags carried each tasting-note tag." });

row("Stash");
stat("Open bags", m("bags", 'status="open"'), { w: 4 });
stat("Unopened bags", m("bags", 'status="unopened"'), { w: 4 });
stat("Finished bags", m("bags", 'status="finished"'), { w: 4 });
stat("Opened → finished", m("bag_days_open_to_finish_average"), { unit: "d", decimals: 1, w: 4, description: "Average, over finished bags." });
stat("Roasted → finished", m("bag_days_roast_to_finish_average"), { unit: "d", decimals: 1, w: 4 });
stat("Bought → finished", m("bag_days_bought_to_finish_average"), { unit: "d", decimals: 1, w: 4 });
table("Bags in your stash", [
  { expr: m("bag_remaining_grams") }, { expr: m("bag_size_grams") }, { expr: m("bag_used_grams") }, { expr: m("bag_brews_total") },
  { expr: m("bag_days_off_roast") }, { expr: m("bag_days_open") }, { expr: m("bag_price") }, { expr: m("bag_rating") }, { expr: m("bag_freshness") },
], { h: 11, sort: "Left (g)", hide: { id: true, "Value #I": true },
  rename: { name: "Coffee", roaster: "Roaster", origin: "Origin", roast_level: "Roast", process: "Process", status: "Status", state: "Rest window",
    "Value #A": "Left (g)", "Value #B": "Size (g)", "Value #C": "Used (g)", "Value #D": "Brews", "Value #E": "Days off roast", "Value #F": "Days open", "Value #G": "Price", "Value #H": "Rating" },
  order: { name: 0, roaster: 1, origin: 2, roast_level: 3, process: 4, status: 5, state: 6 },
  overrides: [
    { matcher: { id: "byName", options: "Left (g)" }, properties: [{ id: "custom.cellOptions", value: { type: "gauge", mode: "basic", valueDisplayMode: "text" } }, { id: "min", value: 0 }, { id: "max", value: 1000 }, { id: "color", value: { mode: "continuous-RdYlGr" } }] },
    { matcher: { id: "byName", options: "Price" }, properties: [{ id: "unit", value: "currencyUSD" }] },
    { matcher: { id: "byName", options: "Rest window" }, properties: [{ id: "mappings", value: [{ type: "value", options: { resting: { text: "Resting", color: "blue" }, peak: { text: "Peak", color: "green" }, past: { text: "Past peak", color: "orange" } } }] }, { id: "custom.cellOptions", value: { type: "color-text" } }] },
  ] });
ranked("Coffee left per bag", m("bag_remaining_grams"), "name", { w: 12, h: 10, unit: "massg", color: { mode: "continuous-RdYlGr" } });
ranked("Days off roast", m("bag_days_off_roast"), "name", { w: 12, h: 10, unit: "d" });
series("Coffee left over time", [{ expr: m("stash_remaining_grams"), legend: "stash" }], { unit: "massg" });
series("Coffee left per bag over time", [{ expr: m("bag_remaining_grams"), legend: "{{name}}" }], { unit: "massg", legendMode: "table", calcs: ["lastNotNull"] });

row("Buying coffee");
stat("Spent, all time", m("spent_total"), { unit: "currencyUSD", decimals: 0, w: 4 });
stat("Spent this year", m("spent_this_year"), { unit: "currencyUSD", decimals: 0, w: 4 });
stat("Average price per kg", m("coffee_price_per_kg_average"), { unit: "currencyUSD", decimals: 2, w: 4 });
stat("Coffee brewed, at cost", m("coffee_brewed_cost_total"), { unit: "currencyUSD", decimals: 0, w: 4 });
stat("Average cost per brew", m("brew_cost_average"), { unit: "currencyUSD", decimals: 2, w: 4 });
stat("Bags bought", `sum(${m("bags_bought_by_month_total")})`, { w: 4, description: "Bags with a purchase date." });
bars("Spent per month", [{ expr: m("spent_by_month_total") }], "month", { unit: "currencyUSD", rename: { Value: "Spent" } });
bars("Bags bought per month", [{ expr: m("bags_bought_by_month_total") }], "month", { rename: { Value: "Bags" } });
bars("Coffee bought vs brewed per month", [{ expr: m("coffee_bought_by_month_grams_total") }, { expr: m("coffee_used_by_month_grams_total") }], "month",
  { unit: "massg", rename: { "Value #A": "Bought", "Value #B": "Brewed" }, color: { mode: "palette-classic" } });
bars("Cost of the coffee you brewed per month", [{ expr: m("coffee_brewed_cost_by_month_total") }], "month", { unit: "currencyUSD", rename: { Value: "Cost" } });
pie("Spent by roaster", m("spent_by_roaster_total"), "roaster", { w: 12, unit: "currencyUSD" });
series("Spending over time", [{ expr: m("spent_total"), legend: "all time" }, { expr: m("spent_this_year"), legend: "this year" }], { unit: "currencyUSD", interp: "stepAfter" });

row("Discover, backups and the instance");
stat("Board editions", m("discover_editions"), { w: 4 });
stat("Last board refresh", `${m("discover_last_refresh_timestamp_seconds")} * 1000`, { unit: "dateTimeFromNow", w: 4 });
stat("Avoid list", m("avoids"), { w: 4 });
stat("Last backup", `${m("last_backup_timestamp_seconds")} * 1000`, { unit: "dateTimeFromNow", w: 4, description: "Nightly at 03:00, plus any you make." });
stat("Backups on disk", m("backups"), { w: 4 });
stat("Database size", m("database_bytes"), { unit: "bytes", w: 4 });
pie("Board picks by status", m("discover_picks"), "status", { w: 8, h: 8 });
pie("Tastings by verdict", m("tastings"), "verdict", { w: 8, h: 8 });
stat("Brewlab version", m("info"), { w: 4, h: 8, format: "table", fields: "/^version$/", textMode: "value", colorMode: "none" });
stat("AI provider", m("ai_configured"), { w: 4, h: 8, colorMode: "none", mappings: [{ type: "value", options: { 0: { text: "Off" }, 1: { text: "On" } } }] });

/* ---------- the dashboard ---------- */
const dashboard = {
  __inputs: [],
  __requires: [{ type: "grafana", id: "grafana", name: "Grafana", version: "10.4.0" }, { type: "datasource", id: "prometheus", name: "Prometheus", version: "1.0.0" }],
  annotations: { list: [] },
  description: "Brewlab: brewing habits, gear, coffee and preferences, the stash, and buying coffee — from Brewlab's /metrics.",
  editable: true,
  graphTooltip: 1,
  links: [{ title: "Brewlab", type: "link", url: "https://github.com/cmerkle/brewlab", targetBlank: true, icon: "external link" }],
  panels,
  refresh: "5m",
  schemaVersion: 39,
  tags: ["brewlab", "coffee"],
  templating: {
    list: [
      { name: "datasource", label: "Prometheus", type: "datasource", query: "prometheus", current: {}, hide: 0, refresh: 1, regex: "", options: [] },
      { name: "job", label: "Brewlab", type: "query", datasource: DS, query: { query: "label_values(brewlab_info, job)", refId: "PrometheusVariableQueryEditor-VariableQuery" }, definition: "label_values(brewlab_info, job)",
        refresh: 1, includeAll: true, multi: false, allValue: ".*", current: {}, options: [], sort: 1, hide: 0 },
    ],
  },
  time: { from: "now-30d", to: "now" },
  timepicker: {},
  timezone: "browser",
  title: "Brewlab",
  uid: "brewlab",
  version: 1,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(dashboard, null, 2) + "\n");
console.log(`${path.relative(process.cwd(), OUT)}: ${panels.filter((p) => p.type !== "row").length} panels in ${panels.filter((p) => p.type === "row").length} rows`);
