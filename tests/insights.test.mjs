// Insights: the numbers behind the dashboard.
import { test } from "node:test";
import assert from "node:assert/strict";

const I = await import("../dist/shared/insights.js");

const now = new Date(2026, 10, 24, 15, 0); // Tue Nov 24 2026, 15:00 local
const at = (y, m, d, h = 8) => new Date(y, m - 1, d, h, 0).toISOString();
const brew = (o) => ({ brewedAt: at(2026, 11, 24), doseG: 15, waterG: 250, rating: null, brewerName: null, grinderName: null, recipeName: null, method: null, coffee: null, inventoryId: null, ...o });

test("periods: [from, to) ending today; previous period of the same length; all time from the first brew", () => {
  const r = I.periodRange("7d", now);
  assert.equal(I.dayKey(r.from), "2026-11-18");
  assert.equal(I.dayKey(r.to), "2026-11-25");
  const p = I.previousRange("7d", r);
  assert.equal(I.dayKey(p.from), "2026-11-11");
  assert.equal(I.dayKey(p.to), "2026-11-18");
  assert.equal(I.previousRange("all", r), null);
  assert.equal(I.dayKey(I.periodRange("all", now, new Date(2026, 0, 5)).from), "2026-01-05");
  assert.equal(I.autoUnit(I.periodRange("30d", now)), "day");
  assert.equal(I.autoUnit(I.periodRange("90d", now)), "week");
  assert.equal(I.autoUnit(I.periodRange("12m", now)), "month");
});

test("timeline: every day / week / month in the range, empty ones included", () => {
  const brews = [brew({ brewedAt: at(2026, 11, 24) }), brew({ brewedAt: at(2026, 11, 24, 18), doseG: 20 }), brew({ brewedAt: at(2026, 11, 20) }), brew({ brewedAt: at(2026, 10, 1) })];
  const r = I.periodRange("7d", now);
  const days = I.timeline(brews, r, "day");
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((b) => b.brews), [0, 0, 1, 0, 0, 0, 2]); // Nov 18 … Nov 24
  assert.equal(days.at(-1).grams, 35);
  assert.equal(days.at(-1).label, "Nov 24");
  const months = I.timeline(brews, I.periodRange("90d", now), "month");
  assert.deepEqual(months.map((b) => [b.label, b.brews]), [["Aug 2026", 0], ["Sep 2026", 0], ["Oct 2026", 1], ["Nov 2026", 3]]);
  const weeks = I.timeline(brews, r, "week");
  assert.equal(weeks[0].start.getDay(), 1, "weeks start on Monday");
});

test("rankBy: largest first, case-insensitive, missing left out, the tail folds into Other", () => {
  const items = ["V60", "v60", "AeroPress", "Switch", null, "V60", "Orea", "Kalita", "Chemex", "Clever", "Origami", "Melitta"].map((n, i) => ({ n, r: i % 2 ? 4 : null }));
  const { rows, missing, total } = I.rankBy(items, (x) => x.n, (x) => x.r, 5);
  assert.equal(missing, 1);
  assert.equal(total, 11);
  assert.deepEqual(rows.map((r) => [r.label, r.count]), [["V60", 3], ["AeroPress", 1], ["Chemex", 1], ["Clever", 1], ["Other", 5]]);
  assert.equal(rows.at(-1).other, 5);
  assert.equal(Math.round(rows[0].share * 100), 27);
  const best = I.bestRated([{ o: "Kenya", r: 5 }, { o: "Kenya", r: 4 }, { o: "Brazil", r: 3 }, { o: "Brazil", r: 3 }, { o: "Peru", r: 5 }], (x) => x.o, (x) => x.r);
  assert.deepEqual(best.map((b) => [b.label, b.avgRating]), [["Kenya", 4.5], ["Brazil", 3]], "Peru has only one rating");
});

test("week × hour grid, ratings, ratio bins, streak", () => {
  const grid = I.weekHours([brew({ brewedAt: at(2026, 11, 23, 7) }), brew({ brewedAt: at(2026, 11, 23, 8) }), brew({ brewedAt: at(2026, 11, 29, 22) }), brew({ brewedAt: "2026-11-20" })]);
  assert.equal(grid[0][2], 2, "two Monday brews 6–9");
  assert.equal(grid[6][7], 1, "Sunday 21–24");
  assert.equal(grid.flat().reduce((a, b) => a + b, 0), 3, "a date without a time isn't placed");
  assert.deepEqual(I.ratingCounts([brew({ rating: 5 }), brew({ rating: 5 }), brew({ rating: 2 })]), [0, 1, 0, 0, 2]);
  const bins = I.ratioCounts([brew({ doseG: 18, waterG: 36 }), brew({ doseG: 15, waterG: 250 }), brew({ doseG: 20, waterG: 320 }), brew({ doseG: 15, waterG: 300 }), brew({ doseG: null })]);
  assert.deepEqual(bins, [1, 0, 0, 0, 0, 1, 1, 0, 1]); // 1:2, 1:16, 1:16.7 → 1:17, 1:20
  const days = [24, 23, 22, 20].map((d) => brew({ brewedAt: at(2026, 11, d) }));
  assert.equal(I.streak(days, now), 3);
  assert.equal(I.streak(days.slice(1), now), 2, "nothing today yet: the streak runs to yesterday");
  assert.equal(I.streak([], now), 0);
});

test("headline numbers for a period", () => {
  const r = I.periodRange("30d", now);
  const brews = [brew({ rating: 4, inventoryId: 1 }), brew({ rating: 5, inventoryId: 1, doseG: 18, waterG: 36 }), brew({ coffee: "Café X" }), brew({ brewedAt: at(2026, 1, 1), rating: 1 })];
  const bags = [
    { id: 1, name: "A", price: 20, purchaseDate: "2026-11-10", finishedDate: "2026-11-20", status: "finished" },
    { id: 2, name: "B", price: 15.5, purchaseDate: "2026-11-01", finishedDate: null, status: "open" },
    { id: 3, name: "C", price: 99, purchaseDate: "2026-01-01", finishedDate: null, status: "open" },
  ];
  const k = I.kpis(brews, bags, r);
  assert.deepEqual(k, { brews: 3, grams: 48, avgRating: 4.5, avgRatio: 16.7, bagsFinished: 1, spent: 35.5, coffees: 2 });
});

test("axis ticks are round", () => {
  assert.deepEqual(I.niceTicks(7), [0, 2, 4, 6, 8]);
  assert.deepEqual(I.niceTicks(1), [0, 0.5, 1]);
  assert.deepEqual(I.niceTicks(23), [0, 10, 20, 30]);
  assert.deepEqual(I.niceTicks(0), [0, 1]);
});

test("cumulative: a running total per day; the last point is the period total; outside the range is ignored", () => {
  const r = I.periodRange("7d", now);
  const pts = I.cumulative(I.gramsEvents([brew({ brewedAt: at(2026, 11, 20), doseG: 15 }), brew({ brewedAt: at(2026, 11, 24), doseG: 20 }), brew({ brewedAt: at(2026, 11, 24, 18), doseG: 18.5 }), brew({ brewedAt: at(2026, 10, 1), doseG: 99 })]), r);
  assert.equal(pts.length, 7);
  assert.deepEqual(pts.map((p) => p.total), [0, 0, 15, 15, 15, 15, 53.5]);
  assert.equal(pts.at(-1).day, 38.5);
  const { events, skipped } = I.spendEvents([
    { id: 1, price: 20, purchaseDate: "2026-11-19" }, { id: 2, price: 15.5, purchaseDate: "2026-11-24" }, { id: 3, price: 30, purchaseDate: null }, { id: 4, price: null, purchaseDate: "2026-11-20" }, { id: 5, price: 99, purchaseDate: "2026-01-01" },
  ]);
  assert.equal(skipped, 2);
  assert.deepEqual(I.cumulative(events, r).map((p) => p.total), [0, 20, 20, 20, 20, 20, 35.5]);
  assert.equal(I.cumulative(events, r).at(-1).total, I.kpis([], events.map((e, i) => ({ id: i, price: e.value, purchaseDate: I.dayKey(e.date) })), r).spent, "agrees with the headline");
});

test("rankBy can weigh groups: grams of coffee per grinder, largest first, shares of the grams", () => {
  const brews = [["ZP6", 15], ["ZP6", 15], ["ZP6", 15], ["DF64", 18], ["DF64", 18], ["Ode", 60], [null, 20]].map(([g, d]) => brew({ grinderName: g, doseG: d }));
  const byCount = I.rankBy(brews, (b) => b.grinderName);
  assert.deepEqual(byCount.rows.map((r) => [r.label, r.value]), [["ZP6", 3], ["DF64", 2], ["Ode", 1]]);
  const byGrams = I.rankBy(brews, (b) => b.grinderName, (b) => b.rating, 8, (b) => b.doseG ?? 0);
  assert.deepEqual(byGrams.rows.map((r) => [r.label, r.value, r.count]), [["Ode", 60, 1], ["ZP6", 45, 3], ["DF64", 36, 2]]);
  assert.equal(byGrams.total, 141);
  assert.equal(Math.round(byGrams.rows[0].share * 100), 43);
  assert.equal(byGrams.missing, 1);
});
