// More → Insights: your coffee habits and preferences at a glance. Everything below the filter row
// follows the same period (and, for the coffee charts, the same scope), so the numbers agree.
import { useMemo, useState } from "react";
import { useData, usePref } from "../ui";
import { METHOD_LABELS, type Method } from "../../shared/grind";
import {
  PERIODS, periodRange, previousRange, inRange, autoUnit, timeline, rankBy, bestRated, weekHours, WEEKDAYS, BANDS,
  ratingCounts, ratioCounts, RATIO_BINS, BAND_STARTS, cumulative, gramsEvents, spendEvents, streak, kpis, COFFEE_FIELDS, brewBag, brewDate,
  type Period, type Unit, type InsightBag, type CoffeeField, type Ranked,
} from "../../shared/insights";
import { ChartCard, ColumnChart, BarList, Heatmap, StatTile, LineChart } from "./charts";

type Scope = "brewed" | "stash" | "all";
/** What the "Your coffee" charts count. Only those four charts; the rest of the page follows the period. */
const SCOPES: Record<Scope, { label: string; hint: string }> = {
  brewed: { label: "Brews in this period", hint: "Each brew in the period, by the Stash bag it was brewed from." },
  stash: { label: "Bags in your stash now", hint: "Open and unopened bags today (the period doesn't apply)." },
  all: { label: "Every bag you've had", hint: "All bags, finished ones included (the period doesn't apply)." },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const grams = (g: number) => (g >= 1000 ? `${(g / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg` : `${g} g`);

/** "+3 vs the previous 30 days" (neutral: more brewing isn't good or bad). */
function delta(now: number | null, prev: number | null, period: Period, f: (n: number) => string = String): string | null {
  if (now == null || prev == null || !PERIODS[period].days) return null;
  const d = Math.round((now - prev) * 10) / 10;
  const when = `the previous ${PERIODS[period].label}`;
  return d === 0 ? `Same as ${when}` : `${d > 0 ? "▲ +" : "▼ −"}${f(Math.abs(d))} vs ${when}`;
}

export function Insights() {
  const { brews, bags, loaded } = useData();
  const [period, setPeriod] = usePref<Period>("insights.period", "30d");
  const [scope, setScope] = usePref<Scope>("insights.scope", "brewed");
  const [unitPick, setUnitPick] = useState<Unit | null>(null);
  const [bestBy, setBestBy] = useState<CoffeeField>("origin");
  /** Gear and recipes ranked by number of brews, or by grams of coffee. */
  const [measure, setMeasure] = usePref<"brews" | "grams">("insights.measure", "brews");
  const p: Period = period in PERIODS ? period : "30d";
  const now = new Date();

  const d = useMemo(() => {
    const first = brews.length ? brews.map((b) => brewDate(b.brewedAt)).reduce((a, b) => (a < b ? a : b)) : null;
    const range = periodRange(p, now, first);
    const prev = previousRange(p, range);
    const inP = inRange(brews, range);
    const bagMap = new Map<number, InsightBag>(bags.map((b) => [b.id, b as InsightBag]));
    const k = kpis(brews, bags as InsightBag[], range);
    const kPrev = prev ? kpis(brews, bags as InsightBag[], prev) : null;
    // Coffee charts: brews (each from its Stash bag) or bags, by the scope.
    const coffeeItems: { bag: InsightBag | null; rating: number | null }[] =
      scope === "brewed" ? inP.map((b) => ({ bag: brewBag(b, bagMap), rating: b.rating }))
        : (bags as InsightBag[]).filter((b) => scope === "all" || b.status !== "finished").map((b) => ({ bag: b, rating: (b as any).rating ?? null }));
    const ratedWithBag = inP.filter((b) => b.rating != null).map((b) => ({ bag: brewBag(b, bagMap), rating: b.rating }));
    return { range, prev, inP, k, kPrev, coffeeItems, ratedWithBag, bagMap };
  }, [brews, bags, p, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const unit = unitPick ?? autoUnit(d.range);
  const tl = useMemo(() => timeline(d.inP, d.range, unit), [d, unit]);
  // Running totals across the period: grams from brews, money from bags bought (by purchase date).
  const cumGrams = useMemo(() => cumulative(gramsEvents(d.inP), d.range), [d]);
  const spend = useMemo(() => spendEvents(bags as InsightBag[]), [bags]);
  const cumSpend = useMemo(() => cumulative(spend.events, d.range), [spend, d]);
  const nBrews = d.inP.length;
  const coffeeWord = scope === "brewed" ? ["brew", "brews"] : ["bag", "bags"];

  const rankRows = (r: { rows: Ranked[] }, word: [string, string]) =>
    r.rows.map((x) => ({ label: x.other ? `Other (${x.other})` : x.label, value: x.count, figure: `${x.count} ${x.count === 1 ? word[0] : word[1]}`, sub: [pct(x.share), x.avgRating != null ? `${x.avgRating}★` : null].filter(Boolean).join(" · ") }));
  const rankTable = (r: { rows: Ranked[] }, what: string, count: string) =>
    ({ head: [what, count, "Share", "Avg rating"], rows: r.rows.map((x) => [x.other ? `Other (${x.other})` : x.label, x.count, pct(x.share), x.avgRating ?? "—"]) });
  // Gear by grams: the figure is the coffee, the brew count moves to the secondary text.
  const gramRows = (r: { rows: Ranked[] }) =>
    r.rows.map((x) => ({ label: x.other ? `Other (${x.other})` : x.label, value: x.value, figure: grams(Math.round(x.value)),
      sub: [pct(x.share), `${x.count} brew${x.count === 1 ? "" : "s"}`, x.avgRating != null ? `${x.avgRating}★` : null].filter(Boolean).join(" · ") }));
  const gramTable = (r: { rows: Ranked[] }, what: string) =>
    ({ head: [what, "Coffee (g)", "Share", "Brews", "Avg rating"], rows: r.rows.map((x) => [x.other ? `Other (${x.other})` : x.label, Math.round(x.value), pct(x.share), x.count, x.avgRating ?? "—"]) });

  if (!loaded) return <p className="muted">Loading…</p>;

  const gearCards: { title: string; key: (b: (typeof d.inP)[number]) => string | null }[] = [
    { title: "Brewers", key: (b) => b.brewerName },
    { title: "Grinders", key: (b) => b.grinderName },
    { title: "Recipes", key: (b) => b.recipeName },
    { title: "Brew methods", key: (b) => (b.method ? METHOD_LABELS[b.method as Method] ?? b.method : null) },
    { title: "Waters", key: (b) => b.waterName ?? null },
  ];
  // Waters only when some brew recorded one; an odd card out spans the row.
  const gearShown = gearCards
    .map((g) => ({ g, r: rankBy(d.inP, g.key, (b) => b.rating, 8, measure === "grams" ? (b) => b.doseG ?? 0 : undefined) }))
    .filter(({ g, r }) => g.title !== "Waters" || r.rows.length > 0);
  const best = bestRated(d.ratedWithBag, (x) => (x.bag ? (x.bag as any)[bestBy] : null), (x) => x.rating);

  return (
    <div className="stack insights" data-testid="insights">
      <div className="insight-filters" role="group" aria-label="What to show">
        <div className="seg big" role="group" aria-label="Period">
          {(Object.keys(PERIODS) as Period[]).map((k) => (
            <button key={k} className={p === k ? "on" : ""} aria-pressed={p === k} aria-label={PERIODS[k].label} title={PERIODS[k].label} onClick={() => { setPeriod(k); setUnitPick(null); }}>{PERIODS[k].short}</button>
          ))}
        </div>
      </div>

      <section className="card insight-hero" data-testid="insight-kpis">
        <div className="hero">
          <div className="stat-label">Brews · {PERIODS[p].label.toLowerCase()}</div>
          <div className="hero-value" data-testid="hero-brews">{nBrews.toLocaleString()}</div>
          <div className="stat-delta muted small">{delta(d.k.brews, d.kPrev?.brews ?? null, p) ?? `Since ${d.range.from.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}</div>
        </div>
        <div className="stat-row">
          <StatTile label="Coffee used" value={grams(d.k.grams)} delta={delta(d.k.grams, d.kPrev?.grams ?? null, p, (g) => grams(g))} testId="kpi-grams" />
          <StatTile label="Average rating" value={d.k.avgRating != null ? `${d.k.avgRating}★` : "—"} delta={delta(d.k.avgRating, d.kPrev?.avgRating ?? null, p, (x) => `${x}★`)} />
          <StatTile label="Average ratio" value={d.k.avgRatio != null ? `1:${d.k.avgRatio}` : "—"} />
          <StatTile label="Coffees" value={String(d.k.coffees)} />
          <StatTile label="Bags finished" value={String(d.k.bagsFinished)} />
          <StatTile label="Spent on bags" value={d.k.spent != null ? money(d.k.spent) : "—"} />
          <StatTile label="Brewing streak" value={`${streak(brews, now)} day${streak(brews, now) === 1 ? "" : "s"}`} />
        </div>
      </section>

      <div className="insights-grid">
        <ChartCard testId="chart-timeline" title={`Brews per ${unit}`} sub={`${nBrews} brew${nBrews === 1 ? "" : "s"} · ${grams(d.k.grams)}`}
          action={
            <div className="seg" role="group" aria-label="Group by">
              {(["day", "week", "month"] as Unit[]).map((u) => <button key={u} className={unit === u ? "on" : ""} aria-pressed={unit === u} onClick={() => setUnitPick(u)}>{u[0].toUpperCase() + u.slice(1)}</button>)}
            </div>
          }
          table={{ head: [unit[0].toUpperCase() + unit.slice(1), "Brews", "Coffee (g)"], rows: tl.map((b) => [b.label, b.brews, Math.round(b.grams)]) }}>
          <ColumnChart data={tl.map((b) => ({ label: b.label, value: b.brews, detail: b.grams ? `${Math.round(b.grams)} g` : undefined }))} unit={["brew", "brews"]} ariaLabel={`Brews per ${unit}`} height={220} />
        </ChartCard>

        <ChartCard testId="chart-when" title="When you brew" sub="By weekday and hour (3-hour blocks)"
          table={{ head: ["Day", ...BANDS], rows: weekHours(d.inP).map((r, i) => [WEEKDAYS[i], ...r]) }}>
          {nBrews ? <Heatmap rows={WEEKDAYS} cols={BANDS} colLabels={BAND_STARTS} grid={weekHours(d.inP)} unit={["brew", "brews"]} /> : <p className="muted small">No brews in this period.</p>}
        </ChartCard>

        <ChartCard testId="chart-cum-grams" title="Coffee used" sub={`Running total · ${grams(Math.round(cumGrams.at(-1)?.total ?? 0))} in ${PERIODS[p].label.toLowerCase()}`}
          table={{ head: ["Day", "That day (g)", "Total (g)"], rows: cumGrams.filter((x) => x.day).map((x) => [x.label, x.day, x.total]) }}>
          <LineChart data={cumGrams.map((x) => ({ label: x.label, value: x.total, day: x.day }))} format={(g) => grams(Math.round(g))} ariaLabel="Coffee used, running total" />
        </ChartCard>

        <ChartCard testId="chart-cum-spend" title="Spent on beans" sub={`Running total by purchase date · ${money(cumSpend.at(-1)?.total ?? 0)}`}
          table={{ head: ["Day", "Bought", "Total"], rows: cumSpend.filter((x) => x.day).map((x) => [x.label, money(x.day), money(x.total)]) }}>
          <LineChart data={cumSpend.map((x) => ({ label: x.label, value: x.total, day: x.day }))} format={(n) => money(n)} ariaLabel="Spent on beans, running total" dayWord="bought that day" />
          {spend.skipped > 0 && <p className="muted small insight-foot">{spend.skipped} bag{spend.skipped === 1 ? " has" : "s have"} no price or purchase date, so {spend.skipped === 1 ? "isn't" : "aren't"} counted.</p>}
        </ChartCard>

        <ChartCard testId="chart-ratings" title="Brew ratings" sub={`${d.inP.filter((b) => b.rating != null).length} rated`}
          table={{ head: ["Rating", "Brews"], rows: ratingCounts(d.inP).map((c, i) => [`${i + 1}★`, c]) }}>
          <ColumnChart data={ratingCounts(d.inP).map((c, i) => ({ label: `${i + 1}★`, value: c }))} unit={["brew", "brews"]} ariaLabel="Brews by rating" height={170} labelGap={24} />
        </ChartCard>

        <ChartCard testId="chart-ratios" title="Brew ratios" sub="Water to coffee"
          table={{ head: ["Ratio", "Brews"], rows: ratioCounts(d.inP).map((c, i) => [RATIO_BINS[i], c]) }}>
          <ColumnChart data={ratioCounts(d.inP).map((c, i) => ({ label: RATIO_BINS[i], value: c }))} unit={["brew", "brews"]} height={170} ariaLabel="Brews by ratio" labelGap={34} />
        </ChartCard>

      </div>

      <div className="insight-section-head">
        <div>
          <h2 className="insight-section">Gear and recipes</h2>
          <div className="muted small">{measure === "grams" ? "Coffee used with each, this period." : "Brews with each, this period."}</div>
        </div>
        <div className="seg big" role="group" aria-label="Gear and recipes by">
          {([["brews", "Brews"], ["grams", "Coffee used"]] as const).map(([k, l]) => (
            <button key={k} className={measure === k ? "on" : ""} aria-pressed={measure === k} onClick={() => setMeasure(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="insights-grid">
        {gearShown.map(({ g, r }, i) => {
          const byGrams = measure === "grams";
          const what = g.title.replace(/s$/, "");
          return (
            <ChartCard key={g.title} wide={gearShown.length % 2 === 1 && i === gearShown.length - 1} testId={`chart-${g.title.toLowerCase().replace(/\s+/g, "-")}`} title={g.title}
              sub={byGrams ? `${grams(Math.round(r.total))} of coffee` : `${r.total} brew${r.total === 1 ? "" : "s"}`}
              table={byGrams ? gramTable(r, what) : rankTable(r, what, "Brews")}>
              <BarList rows={byGrams ? gramRows(r) : rankRows(r, ["brew", "brews"])} empty="No brews in this period." note={r.missing ? `${r.missing} brew${r.missing === 1 ? "" : "s"} without one recorded.` : undefined} />
            </ChartCard>
          );
        })}
      </div>

      <div className="insight-section-head">
        <div>
          <h2 className="insight-section">Your coffee</h2>
          <div className="muted small" data-testid="coffee-scope-hint">{SCOPES[scope].hint}</div>
        </div>
        <select className="pill-select" aria-label="Your coffee charts count" value={scope in SCOPES ? scope : "brewed"} onChange={(e) => setScope(e.target.value as Scope)}>
          {(Object.keys(SCOPES) as Scope[]).map((s) => <option key={s} value={s}>{SCOPES[s].label}</option>)}
        </select>
      </div>
      <div className="insights-grid">
        {COFFEE_FIELDS.map((f) => {
          const r = rankBy(d.coffeeItems, (x) => (x.bag ? (x.bag as any)[f.field] : null), (x) => x.rating);
          const noBag = scope === "brewed" ? d.coffeeItems.filter((x) => !x.bag).length : 0;
          return (
            <ChartCard key={f.field} testId={`chart-coffee-${f.field}`} title={f.label} table={rankTable(r, f.label.replace(/s$/, ""), scope === "brewed" ? "Brews" : "Bags")}>
              <BarList rows={rankRows(r, coffeeWord as [string, string])} empty={scope === "brewed" ? "No brews from Stash bags in this period." : "No bags yet."}
                note={noBag ? `${noBag} brew${noBag === 1 ? " wasn't" : "s weren't"} from a Stash bag.` : r.missing ? `${r.missing} without one recorded.` : undefined} />
            </ChartCard>
          );
        })}

        <ChartCard wide testId="chart-best" title="What you rate highest" sub="Average brew rating, where you've rated at least 2 brews"
          action={
            <select className="pill-select small-select" aria-label="Rate by" value={bestBy} onChange={(e) => setBestBy(e.target.value as CoffeeField)}>
              {COFFEE_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
            </select>
          }
          table={{ head: [COFFEE_FIELDS.find((f) => f.field === bestBy)!.label.replace(/s$/, ""), "Avg rating", "Rated brews"], rows: best.map((b) => [b.label, `${b.avgRating}★`, b.rated]) }}>
          <BarList rows={best.map((b) => ({ label: b.label, value: b.avgRating!, figure: `${b.avgRating}★`, sub: `${b.rated} rated` }))} max={5}
            empty="Rate a few brews from Stash bags and this fills in." />
        </ChartCard>
      </div>
    </div>
  );
}
