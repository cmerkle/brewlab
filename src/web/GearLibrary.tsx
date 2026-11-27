// Browsing the gear library: Brewers / Grinders tabs, a search over both, kind chips, and groups —
// brewers by kind, grinders by brand. Used by Gear → Add gear and setup's Brewers / Grinders steps.
import { useState, type ReactNode } from "react";
import { SearchInput } from "./ui";

export interface LibGear {
  id: string; name: string; brand: string | null; type: "grinder" | "brewer" | "other"; category: string;
  units: string | null; hasRanges: boolean; methods: string[]; confidence: string | null; owned: boolean;
}

export const CATEGORY_LABELS: Record<string, string> = {
  "hand-grinder": "Hand grinders", "electric-grinder": "Electric grinders", "cone-dripper": "Cone drippers",
  "flat-bottom-dripper": "Flat-bottom drippers", "hybrid-dripper": "Hybrid / switch drippers", "immersion-dripper": "Immersion drippers",
  "aeropress": "AeroPress", "rapid-brewer": "Rapid brewers", "french-press": "French presses", "moka-pot": "Moka pots",
  "espresso-machine": "Espresso machines", "batch-brewer": "Drip coffee makers", "cezve": "Cezves (Turkish)",
  "cold-brew-maker": "Cold brew makers", "siphon": "Siphons", "other": "Other",
};
/** Short chip labels for the kind filter. */
const CHIP_LABELS: Record<string, string> = {
  "hand-grinder": "Hand", "electric-grinder": "Electric", "cone-dripper": "Cone", "flat-bottom-dripper": "Flat-bottom",
  "hybrid-dripper": "Hybrid", "immersion-dripper": "Immersion", "aeropress": "AeroPress", "rapid-brewer": "Rapid",
  "french-press": "French press", "moka-pot": "Moka", "espresso-machine": "Espresso", "batch-brewer": "Drip machine",
  "cezve": "Cezve", "cold-brew-maker": "Cold brew", "siphon": "Siphon", "other": "Other",
};

export type GearTab = "brewer" | "grinder";
const tabOf = (g: LibGear): GearTab => (g.type === "grinder" ? "grinder" : "brewer");
const NO_BRAND = "Other makers";
const byName = (a: LibGear, b: LibGear) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const byBrandName = (a: LibGear, b: LibGear) =>
  (a.brand ?? "~").localeCompare(b.brand ?? "~", undefined, { sensitivity: "base" }) || byName(a, b);

export function matchesGear(g: LibGear, needle: string) {
  return !needle || `${g.name} ${g.brand ?? ""} ${CATEGORY_LABELS[g.category] ?? ""}`.toLowerCase().includes(needle);
}

/**
 * The library, organised. `tab` + `onTab` show the Brewers / Grinders tabs; without `onTab` only
 * that type is listed (setup's steps). `row` renders one item's line (name, note, button).
 */
export function GearLibraryBrowser({ items, tab, onTab, row, emptyHint }: {
  items: LibGear[] | null; tab: GearTab; onTab?: (t: GearTab) => void;
  row: (g: LibGear) => ReactNode; emptyHint: string;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const all = items ?? [];
  const matching = all.filter((g) => matchesGear(g, needle));
  const count = (t: GearTab) => matching.filter((g) => tabOf(g) === t).length;
  const inTab = matching.filter((g) => tabOf(g) === tab);
  // Kind chips: the kinds this tab has (counted with the search applied).
  const kinds = Object.keys(CATEGORY_LABELS).filter((c) => all.some((g) => tabOf(g) === tab && g.category === c));
  const activeKind = kind && kinds.includes(kind) ? kind : null;
  const shown = inTab.filter((g) => !activeKind || g.category === activeKind);

  // Brewers by kind (then brand); grinders by brand.
  const groups: [string, LibGear[]][] = tab === "brewer"
    ? kinds.map((c) => [CATEGORY_LABELS[c], shown.filter((g) => g.category === c).sort(byBrandName)] as [string, LibGear[]]).filter(([, gs]) => gs.length)
    : [...new Set(shown.map((g) => g.brand ?? NO_BRAND))]
      .sort((a, b) => (a === NO_BRAND ? 1 : b === NO_BRAND ? -1 : a.localeCompare(b, undefined, { sensitivity: "base" })))
      .map((b) => [b, shown.filter((g) => (g.brand ?? NO_BRAND) === b).sort(byName)] as [string, LibGear[]]);

  const other: GearTab = tab === "brewer" ? "grinder" : "brewer";
  const label = (t: GearTab) => (t === "brewer" ? "Brewers" : "Grinders");
  return (
    <div className="stack" data-testid="gear-library-browser">
      {onTab && (
        <div className="tabs small" role="tablist" aria-label="Brewers or grinders">
          {(["brewer", "grinder"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} data-testid={`lib-tab-${t}`}
              onClick={() => { onTab(t); setKind(null); }}>{label(t)} ({count(t)})</button>
          ))}
        </div>
      )}
      <SearchInput placeholder={onTab ? "Search brewers and grinders…" : tab === "brewer" ? "Search brewers…" : "Search grinders…"}
        label={onTab ? "Search the gear library" : `Search the ${tab} library`} value={q} onChange={setQ} />
      {kinds.length > 1 && (
        <div className="chip-row" role="group" aria-label={tab === "brewer" ? "Kind of brewer" : "Kind of grinder"}>
          <button type="button" className={`chip${activeKind ? "" : " on"}`} aria-pressed={!activeKind} onClick={() => setKind(null)}>All</button>
          {kinds.map((c) => {
            const n = inTab.filter((g) => g.category === c).length;
            return (
              <button type="button" key={c} className={`chip${activeKind === c ? " on" : ""}`} aria-pressed={activeKind === c}
                onClick={() => setKind(activeKind === c ? null : c)} disabled={!n && activeKind !== c}>
                {CHIP_LABELS[c] ?? c} <span className="n">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {!items && <p className="muted">Loading…</p>}
      {items && shown.length === 0 && (
        <p className="muted" data-testid="lib-empty">
          {onTab && count(other) > 0 && !activeKind
            ? <>No {label(tab).toLowerCase()} match — {count(other)} {count(other) === 1 ? label(other).toLowerCase().slice(0, -1) : label(other).toLowerCase()} {count(other) === 1 ? "does" : "do"}. <button className="link" onClick={() => onTab(other)}>Show {label(other).toLowerCase()}</button></>
            : emptyHint}
        </p>
      )}
      {groups.map(([title, gs]) => (
        <section key={title} data-testid="lib-group">
          <h2 className="group">{title} <span className="muted small">{gs.length}</span></h2>
          <ul className="lib-list">{gs.map((g) => <li key={g.id} data-lib={g.id}>{row(g)}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}
