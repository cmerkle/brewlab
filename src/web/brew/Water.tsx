// More → Water: water recipes (a base water, a volume and additives), from the library or your own.
// Recipes name a default water and brews record theirs, so the Brew Log can compare waters.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type WaterCatalog, type WaterRecipe, type WaterTemplate } from "../api";
import { useData, Field, FullScreen, ErrorBox, NumInput, useAction } from "../ui";
import {
  AMOUNT_UNITS, CONCENTRATE_UNITS, VOLUME_UNITS, VOLUME_LABELS, hardness, unitsFor, fmtPpm, fmtAmount, fmtVolume,
  type AmountUnit, type ConcentrateMap, type Hardness, type VolumeUnit, type WaterLine,
} from "../../shared/water";

/* ---------- the library (bases, additives, recipes), fetched once ---------- */

let catalogPromise: Promise<WaterCatalog> | null = null;
export function useWaterCatalog(refresh = 0) {
  const [cat, setCat] = useState<WaterCatalog | null>(null);
  useEffect(() => {
    if (refresh || !catalogPromise) catalogPromise = api.get<WaterCatalog>("/api/water/catalog");
    let live = true;
    catalogPromise.then((c) => live && setCat(c), () => { catalogPromise = null; });
    return () => { live = false; };
  }, [refresh]);
  return cat;
}

/** "GH 90 · KH 43 ppm" — unknown values show as —. */
export function HardnessLine({ h, className = "small" }: { h: Hardness; className?: string }) {
  return (
    <span className={className} data-testid="water-hardness">
      GH <strong>{fmtPpm(h.gh)}</strong> · KH <strong>{fmtPpm(h.kh)}</strong> <span className="muted">ppm</span>
    </span>
  );
}

const linesText = (lines: WaterLine[]) => (lines.length ? lines.map((l) => `${fmtAmount(l)} ${l.name}`).join(" · ") : "nothing added");

/** A water recipe picker for recipes, brew setup and the brew log. Keeps a removed water's name. */
export function WaterSelect({ id, value, onChange, keptName, label = "Water recipe" }: {
  id: string; value: number | null; onChange: (id: number | null) => void; keptName?: string | null; label?: string;
}) {
  const { water } = useData();
  const missing = value == null && keptName;
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{missing ? `${keptName} (removed)` : "— none —"}</option>
        {water.filter((w) => !w.concentrate || w.id === value).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
    </Field>
  );
}

/* ---------- the page ---------- */

export function Water() {
  const { water, loaded } = useData();
  const [editing, setEditing] = useState<WaterRecipe | "new" | null>(null);
  const [adding, setAdding] = useState(false);
  useAction("add-water", () => setAdding(true));

  return (
    <div className="stack">
      <p className="muted small">
        Water recipes: a base water, how much, and what you add. Pick one on a recipe or when you brew, and the Brew Log
        compares how each water rated. Hardness (GH) and alkalinity (KH) are in ppm as CaCO₃.
      </p>
      {loaded && water.length === 0 && (
        <section className="card">
          <p>No water recipes yet.</p>
          <div className="row wrap">
            <button className="primary" onClick={() => setAdding(true)}>Add from the library</button>
            <button onClick={() => setEditing("new")}>Make your own</button>
          </div>
        </section>
      )}
      {water.map((w) => (
        <section key={w.id} className="card water-card" data-testid={`water-${w.id}`}>
          <header>
            <h3>{w.name}</h3>
            {w.concentrate ? <span className="tag">concentrate</span> : w.catalogId && <span className="tag">library</span>}
          </header>
          <div className="small">{fmtVolume(w.volume, w.volumeUnit)} {w.baseName ?? "water"} + {linesText(w.additives)}</div>
          {w.concentrate && <div className="small muted">The stock itself (add it by the gram to other waters):</div>}
          <HardnessLine h={w.hardness} />
          {!w.concentrate && <div className="small muted" data-testid="water-usage">
            {w.usage.recipes ? `${w.usage.recipes} recipe${w.usage.recipes === 1 ? "" : "s"} · ` : ""}
            {w.usage.brews} brew{w.usage.brews === 1 ? "" : "s"}
            {w.usage.avgRating != null ? ` · avg ${w.usage.avgRating.toFixed(1)}★` : ""}
          </div>}
          <div className="row wrap">
            <button onClick={() => setEditing(w)}>Edit</button>
            {w.source && <a className="small" href={w.source} target="_blank" rel="noreferrer">Source</a>}
          </div>
        </section>
      ))}
      {loaded && water.length > 0 && (
        <div className="row wrap">
          <button onClick={() => setAdding(true)}>Add from the library</button>
          <button onClick={() => setEditing("new")}>Make your own</button>
        </div>
      )}
      {adding && <AddWater onClose={() => setAdding(false)} onCustom={() => { setAdding(false); setEditing("new"); }} />}
      {editing && <WaterEditor water={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AddWater({ onClose, onCustom }: { onClose: () => void; onCustom: () => void }) {
  const { reload, act } = useData();
  const [refresh, setRefresh] = useState(0);
  const cat = useWaterCatalog(refresh);
  const add = (t: WaterTemplate) =>
    act(async () => {
      await api.post("/api/water/from-catalog", { catalogId: t.id });
      await reload(["water"]);
      setRefresh((n) => n + 1);
    }, `${t.name} added — edit your copy any time`);
  return (
    <FullScreen title="Add water" onClose={onClose} footer={<button className="block" onClick={onCustom}>Make your own</button>}>
      <div className="stack">
        <p className="muted small">Each library recipe cites where it comes from. Adding one gives you your own copy to change.</p>
        {!cat && <p className="muted">Loading…</p>}
        {cat?.recipes.map((t) => (
          <section key={t.id} className="card" data-testid={`water-lib-${t.id}`}>
            <header>
              <h3>{t.name}</h3>
              {t.owned && <span className="tag">added</span>}
            </header>
            <div className="small">{fmtVolume(t.volume, t.volumeUnit)} {t.baseName} + {linesText(t.lines)}</div>
            <HardnessLine h={t.hardness} />
            {t.notes && <div className="small muted">{t.notes}</div>}
            <div className="row wrap">
              <button className={t.owned ? "" : "primary"} onClick={() => add(t)} aria-label={`Add ${t.name}`}>{t.owned ? "Add another copy" : "Add"}</button>
              <a className="small" href={t.source} target="_blank" rel="noreferrer">Source</a>
            </div>
          </section>
        ))}
      </div>
    </FullScreen>
  );
}

/* ---------- editor ---------- */

const CUSTOM = "__custom";
type Line = WaterLine & { key: number };
let nextKey = 1;

function WaterEditor({ water, onClose }: { water: WaterRecipe | null; onClose: () => void }) {
  const { reload, toast, act, water: waters } = useData();
  const cat = useWaterCatalog();
  const [f, setF] = useState(() => ({
    name: water?.name ?? "",
    baseId: water?.baseId ?? null,
    baseName: water?.baseName ?? "",
    baseGh: water?.baseGh ?? null as number | null,
    baseKh: water?.baseKh ?? null as number | null,
    volume: water?.volume ?? (1 as number | null),
    volumeUnit: water?.volumeUnit ?? ("L" as VolumeUnit),
    notes: water?.notes ?? "",
    source: water?.source ?? "",
    concentrate: water?.concentrate ?? false,
  }));
  const [lines, setLines] = useState<Line[]>(() => (water?.additives ?? []).map((l) => ({ ...l, key: nextKey++ })));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // A new water starts from the library's first base (distilled) once the library has loaded.
  const baseTouched = useRef(Boolean(water));
  useEffect(() => {
    if (!baseTouched.current && cat?.bases[0]) setF((x) => ({ ...x, baseId: cat.bases[0].id }));
  }, [cat]);
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const base = cat?.bases.find((b) => b.id === f.baseId);
  const baseUnknown = !base || base.gh == null || base.kh == null;
  const mix = { ...f, volume: f.volume ?? 0, additives: lines.filter((l) => l.amount > 0) };
  // Your concentrates (not this water itself) and their strength, for lines that add one.
  const myConcentrates = waters.filter((w) => w.concentrate && w.id !== water?.id);
  const concMap: ConcentrateMap = new Map(myConcentrates.map((w) => [w.id, { name: w.name, gh: w.hardness.gh, kh: w.hardness.kh }]));
  const result = useMemo(() => (cat ? hardness(mix, cat, concMap) : null), [cat, JSON.stringify(mix), waters]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const a = cat?.additives ?? [];
    return [
      ["Minerals", a.filter((x) => x.kind === "salt")],
      ["Drops", a.filter((x) => x.kind === "drops")],
      ["Packets", a.filter((x) => x.kind === "packet")],
      ["Concentrates", a.filter((x) => x.kind === "concentrate")],
    ] as const;
  }, [cat]);

  const pickAdditive = (l: Line, v: string) => {
    if (v === CUSTOM) return setLine(l.key, { additiveId: null, concentrateId: null, name: l.additiveId || l.concentrateId != null ? "" : l.name, unit: l.unit });
    if (v.startsWith("c:")) {
      const c = myConcentrates.find((w) => w.id === Number(v.slice(2)))!;
      return setLine(l.key, { additiveId: null, concentrateId: c.id, name: c.name, unit: CONCENTRATE_UNITS.includes(l.unit) ? l.unit : "g", gh: null, kh: null });
    }
    const a = cat!.additives.find((x) => x.id === v)!;
    setLine(l.key, { additiveId: a.id, concentrateId: null, name: a.name, unit: unitsFor(a).includes(l.unit) ? l.unit : a.ref.unit, gh: null, kh: null });
  };
  const addLine = () => {
    const a = cat?.additives[0];
    setLines((ls) => [...ls, { key: nextKey++, additiveId: a?.id ?? null, name: a?.name ?? "", amount: 0, unit: (a?.ref.unit ?? "g") as AmountUnit }]);
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const body = {
        ...f, baseId: f.baseId || null, baseName: f.baseId ? null : f.baseName || null,
        baseGh: baseUnknown ? f.baseGh : null, baseKh: baseUnknown ? f.baseKh : null,
        notes: f.notes || null, source: f.source || null,
        additives: lines.map(({ key: _k, ...l }) => l),
      };
      if (water) await api.put(`/api/water/${water.id}`, body);
      else await api.post("/api/water", body);
      await reload(["water", "recipes", "brews"]);
      toast("Water saved");
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!water || !confirm(`Delete ${water.name}? Recipes and brews that used it keep its name.`)) return;
    const ok = await act(async () => {
      await api.del(`/api/water/${water.id}`);
      await reload(["water", "recipes", "brews"]);
    }, "Water deleted");
    if (ok) onClose();
  };

  return (
    <FullScreen title={water ? "Edit water" : "New water"} onClose={onClose}
      footer={<div className="row">{water && <button className="danger" onClick={remove}>Delete</button>}<button onClick={onClose}>Cancel</button><button className="primary grow" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save water"}</button></div>}>
      <div className="stack form" data-testid="water-form">
        <Field label="Name" htmlFor="wr-name"><input id="wr-name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Soft & bright" /></Field>
        <label className="check">
          <input type="checkbox" id="wr-concentrate" checked={f.concentrate} onChange={(e) => set("concentrate", e.target.checked)} />
          <span>This is a concentrate: a stock solution you add by the gram to other waters</span>
        </label>
        <div className="grid2">
          <Field label="Base water" htmlFor="wr-base">
            <select id="wr-base" value={f.baseId ?? ""} onChange={(e) => { baseTouched.current = true; set("baseId", e.target.value || null); }}>
              {cat?.bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="">Other…</option>
            </select>
          </Field>
          <div className="grid2 tight">
            <Field label="Volume" htmlFor="wr-volume" hint="All of it, additives included"><NumInput id="wr-volume" value={f.volume} onChange={(n) => set("volume", n)} min={0} max={100000} decimals={3} /></Field>
            <Field label="Unit" htmlFor="wr-volunit">
              <select id="wr-volunit" value={f.volumeUnit} onChange={(e) => set("volumeUnit", e.target.value as VolumeUnit)}>
                {VOLUME_UNITS.map((u) => <option key={u} value={u}>{VOLUME_LABELS[u]}</option>)}
              </select>
            </Field>
          </div>
        </div>
        {!f.baseId && <Field label="Base water name" htmlFor="wr-basename"><input id="wr-basename" value={f.baseName} onChange={(e) => set("baseName", e.target.value)} placeholder="e.g. Brita-filtered tap" /></Field>}
        {base?.note && <div className="hint">{base.note}</div>}
        {baseUnknown && (
          <div className="grid2">
            <Field label="Base hardness (GH, ppm)" htmlFor="wr-basegh"><NumInput id="wr-basegh" value={f.baseGh} onChange={(n) => set("baseGh", n)} min={0} max={5000} decimals={1} /></Field>
            <Field label="Base alkalinity (KH, ppm)" htmlFor="wr-basekh"><NumInput id="wr-basekh" value={f.baseKh} onChange={(n) => set("baseKh", n)} min={0} max={5000} decimals={1} /></Field>
          </div>
        )}

        <h3>Additives</h3>
        {lines.length === 0 && <p className="muted small">Nothing added yet.</p>}
        {lines.map((l, i) => {
          const a = l.additiveId ? cat?.additives.find((x) => x.id === l.additiveId) : undefined;
          const conc = l.concentrateId != null;
          const units = a ? unitsFor(a) : conc ? CONCENTRATE_UNITS : AMOUNT_UNITS;
          return (
            <div key={l.key} className="step-edit" data-testid={`water-line-${i}`}>
              <Field label={`Additive ${i + 1}`} htmlFor={`wr-add-${i}`}>
                <select id={`wr-add-${i}`} value={l.additiveId ?? (conc ? `c:${l.concentrateId}` : CUSTOM)} onChange={(e) => pickAdditive(l, e.target.value)}>
                  {groups.map(([label, list]) => list.length > 0 && (
                    <optgroup key={label} label={label}>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                  ))}
                  {!f.concentrate && (myConcentrates.length > 0 || conc) && (
                    <optgroup label="Your concentrates">
                      {myConcentrates.map((w) => <option key={w.id} value={`c:${w.id}`}>{w.name}</option>)}
                      {conc && !concMap.has(l.concentrateId!) && <option value={`c:${l.concentrateId}`}>{l.name}</option>}
                    </optgroup>
                  )}
                  <option value={CUSTOM}>Your own…</option>
                </select>
              </Field>
              {!l.additiveId && !conc && <Field label="Name" htmlFor={`wr-lname-${i}`}><input id={`wr-lname-${i}`} value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="e.g. Apax Lab Jamaica" /></Field>}
              <div className="grid2">
                <Field label="Amount" htmlFor={`wr-amt-${i}`}><NumInput id={`wr-amt-${i}`} value={l.amount || null} onChange={(n) => setLine(l.key, { amount: n ?? 0 })} min={0} max={100000} decimals={3} /></Field>
                <Field label="Unit" htmlFor={`wr-unit-${i}`}>
                  <select id={`wr-unit-${i}`} value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value as AmountUnit })}>
                    {units.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
              </div>
              {!l.additiveId && !conc && (
                <div className="grid2">
                  <Field label="Adds GH (ppm), if known" htmlFor={`wr-lgh-${i}`}><NumInput id={`wr-lgh-${i}`} value={l.gh ?? null} onChange={(n) => setLine(l.key, { gh: n })} min={0} max={5000} decimals={1} /></Field>
                  <Field label="Adds KH (ppm), if known" htmlFor={`wr-lkh-${i}`}><NumInput id={`wr-lkh-${i}`} value={l.kh ?? null} onChange={(n) => setLine(l.key, { kh: n })} min={0} max={5000} decimals={1} /></Field>
                </div>
              )}
              {a?.note && <div className="hint">{a.note}{a.source && <> <a href={a.source} target="_blank" rel="noreferrer">Source</a></>}</div>}
              <button type="button" className="link danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove additive</button>
            </div>
          );
        })}
        <button type="button" onClick={addLine}>+ Add an additive</button>

        {result && (
          <div className="card water-result" data-testid="water-result" role="status">
            <HardnessLine h={result} className="" />
            {result.unknown.length > 0 && <ul className="plain small muted">{result.unknown.map((u) => <li key={u}>{u}</li>)}</ul>}
          </div>
        )}
        <Field label="Notes" htmlFor="wr-notes"><textarea id="wr-notes" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <Field label="Source (link)" htmlFor="wr-source"><input id="wr-source" type="url" inputMode="url" value={f.source} onChange={(e) => set("source", e.target.value)} placeholder="https://…" /></Field>
        <ErrorBox error={error} />
      </div>
    </FullScreen>
  );
}
