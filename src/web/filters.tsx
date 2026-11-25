// The filter button (inside a search box), the filter sheet and the active-filter chips. Shared by
// the Brew Log and the Stash / Archive; the facets and date fields come from src/shared.
import { FullScreen, Field, Glyph, fmtDate } from "./ui";
import { NO_FILTERS, activeCount, facetOptions, matchesFilters, same, setRange, togglePick, type DateDef, type FacetDef, type Filters } from "../shared/filters";

export function FilterButton({ filters, onClick }: { filters: Filters; onClick: () => void }) {
  const n = activeCount(filters);
  return (
    <button type="button" className={`filter-btn${n ? " on" : ""}`} aria-label={n ? `Filters (${n} on)` : "Filters"} aria-haspopup="dialog" onClick={onClick}>
      <Glyph name="filter" size={18} />
      {n > 0 && <span className="filter-badge" aria-hidden="true">{n}</span>}
    </button>
  );
}

/** The filters that are on, as chips: × drops one; Clear all drops every one. */
export function ActiveFilters<T>({ facets, dates, filters, onChange }: { facets: readonly FacetDef<T>[]; dates: readonly DateDef<T>[]; filters: Filters; onChange: (f: Filters) => void }) {
  if (!activeCount(filters)) return null;
  const chips: { key: string; label: string; what: string; drop: () => Filters }[] = [];
  for (const f of facets) for (const v of filters.picked[f.id] ?? []) chips.push({ key: f.id + v, label: v, what: f.label, drop: () => togglePick(filters, f.id, v) });
  for (const d of dates) {
    const r = filters.dates[d.id];
    if (!r?.from && !r?.to) continue;
    const label = r.from && r.to ? `${fmtDate(r.from)} – ${fmtDate(r.to)}` : r.from ? `from ${fmtDate(r.from)}` : `until ${fmtDate(r.to!)}`;
    chips.push({ key: "date-" + d.id, label, what: d.label, drop: () => setRange(filters, d.id, null, null) });
  }
  return (
    <div className="active-filters" data-testid="active-filters">
      {chips.map((c) => (
        <span key={c.key} className="ptag">
          <span className="ptag-toggle"><span className="muted">{c.what}: </span>{c.label}</span>
          <button type="button" className="ptag-x" aria-label={`Remove filter ${c.what}: ${c.label}`} onClick={() => onChange(c.drop())}>×</button>
        </span>
      ))}
      <button type="button" className="link small" onClick={() => onChange(NO_FILTERS)}>Clear all</button>
    </div>
  );
}

/**
 * Pick values per facet (any of them within one; all facets together) and date ranges. Each value
 * shows how many items it would leave, given the other picks and the search. A facet with a single
 * value and nothing picked is left out (it couldn't narrow anything), as is a date nobody has.
 */
export function FilterSheet<T>({ title, items, facets, dates, filters, onChange, onClose, query, noun }: {
  title: string; items: T[]; facets: readonly FacetDef<T>[]; dates: readonly DateDef<T>[]; filters: Filters;
  onChange: (f: Filters) => void; onClose: () => void; query: (x: T) => boolean; noun: [string, string];
}) {
  const n = items.filter((x) => matchesFilters(x, facets, dates, filters) && query(x)).length;
  const shownDates = dates.filter((d) => items.some((x) => d.get(x)));
  return (
    <FullScreen title={title} onClose={onClose}
      footer={
        <div className="row-actions">
          <button disabled={!activeCount(filters)} onClick={() => onChange(NO_FILTERS)}>Clear all</button>
          <button className="primary" onClick={onClose} data-testid="filter-show">Show {n} {n === 1 ? noun[0] : noun[1]}</button>
        </div>
      }>
      <div className="stack filter-sheet" data-testid="filter-sheet">
        {facets.map((f) => {
          const opts = facetOptions(items, facets, dates, f.id, filters, query);
          const picked = filters.picked[f.id] ?? [];
          if (!opts.length || (opts.length < 2 && !picked.length)) return null;
          return (
            <section key={f.id} className="facet" data-testid={`facet-${f.id}`}>
              <h3>{f.label}</h3>
              <div className="chips" role="group" aria-label={f.label}>
                {opts.map((o) => {
                  const on = picked.some((v) => same(v, o.value));
                  return (
                    <button key={o.value} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on}
                      aria-label={`${o.value}, ${o.count} ${o.count === 1 ? noun[0] : noun[1]}`} onClick={() => onChange(togglePick(filters, f.id, o.value))}>
                      {o.value}<span className="n">{o.count}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {shownDates.map((d) => {
          const r = filters.dates[d.id] ?? {};
          return (
            <section key={d.id} className="facet" data-testid={`dates-${d.id}`}>
              <h3>{d.label}</h3>
              <div className="filter-dates">
                <Field label="From"><input type="date" aria-label={`${d.label} from`} value={r.from ?? ""} max={r.to ?? undefined} onChange={(e) => onChange(setRange(filters, d.id, e.target.value, r.to))} /></Field>
                <Field label="To"><input type="date" aria-label={`${d.label} to`} value={r.to ?? ""} min={r.from ?? undefined} onChange={(e) => onChange(setRange(filters, d.id, r.from, e.target.value))} /></Field>
              </div>
            </section>
          );
        })}
      </div>
    </FullScreen>
  );
}
