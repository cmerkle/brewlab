import { useEffect, useState } from "react";
import { CATEGORY_LABELS } from "../Setup";
import { api, type Gear as GearT } from "../api";
import { useData, Field, FullScreen, ErrorBox, NumInput, useAction, SearchInput } from "../ui";
import { METHODS, METHOD_LABELS, validateRanges, type Method, type GrindRanges } from "../../shared/grind";

const TYPES = [
  { id: "grinder", label: "Grinders" },
  { id: "brewer", label: "Brewers" },
  { id: "other", label: "Other (scales, kettles, accessories)" },
] as const;

export function Gear({ editId, onEditDone }: { editId: string | null; onEditDone: () => void }) {
  const { gear, recipes } = useData();
  const [editing, setEditing] = useState<GearT | "new" | null>(null);
  const [picking, setPicking] = useState(false);
  useAction("add-gear", () => setPicking(true));
  useEffect(() => {
    if (editId) {
      const g = gear.find((x) => x.id === editId);
      if (g) setEditing(g);
    }
  }, [editId, gear]);
  const close = () => {
    setEditing(null);
    onEditDone();
  };
  return (
    <div className="stack">
      {TYPES.map((t) => {
        const items = gear.filter((g) => g.type === t.id);
        return (
          <section key={t.id}>
            <h2 className="group">{t.label}</h2>
            {items.length === 0 && <p className="muted">None yet.</p>}
            <div className="cards">
              {items.map((g) => {
                const used = recipes.filter((r) => r.brewerId === g.id || r.grinderId === g.id).length;
                return (
                  <article key={g.id} className="card" data-testid={`gear-${g.id}`}>
                    <header><h3>{g.name}</h3>{g.brand && <span className="muted">{g.brand}</span>}</header>
                    {g.details && <p className="muted">{g.details}</p>}
                    {g.type === "grinder" && (
                      <div className="muted small">
                        {g.units ? `Units: ${g.units}` : "Units: numbered settings"}{g.burrs ? ` · ${g.burrs}` : ""}
                        {g.espressoCapable != null ? ` · ${g.espressoCapable ? "espresso-capable" : "filter only"}` : ""}
                        {" · "}
                        {g.grindRanges && Object.keys(g.grindRanges.methods ?? {}).length
                          ? `${Object.keys(g.grindRanges.methods).length} method ranges${g.library?.confidence ? ` (library: ${g.library.confidence})` : ""}`
                          : "no conversion data yet"}
                      </div>
                    )}
                    {g.variants && g.variants.length > 0 && <div className="muted small">Variants: {g.variants.join(", ")}</div>}
                    {used > 0 && <div className="muted small">Used by {used} recipe{used > 1 ? "s" : ""}</div>}
                    <div className="row"><button onClick={() => setEditing(g)}>Edit</button></div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {picking && <LibraryPicker onClose={() => setPicking(false)} onCustom={() => { setPicking(false); setEditing("new"); }} />}
      {editing && <GearEditor item={editing === "new" ? null : editing} onClose={close} />}
    </div>
  );
}

type RangeForm = Partial<Record<Method, { low: number | null; high: number | null }>>;

function GearEditor({ item, onClose }: { item: GearT | null; onClose: () => void }) {
  const { reload, toast, recipes, act } = useData();
  // Editing pre-fills the saved ranges (copied from the library when the gear was added).
  const base: GrindRanges | null = item?.grindRanges ?? null;
  const [f, setF] = useState({
    name: item?.name ?? "",
    type: (item?.type ?? "grinder") as GearT["type"],
    brand: item?.brand ?? "",
    details: item?.details ?? "",
    units: item?.units ?? "clicks",
    burrs: item?.burrs ?? "",
    espressoCapable: item?.espressoCapable ?? null as boolean | null,
    variants: (item?.variants ?? []).join(", "),
    defaultMethod: (item?.defaultMethod ?? null) as Method | null,
    category: (item?.category ?? "") as string,
    step: base?.step ?? null as number | null,
    min: base?.min ?? null as number | null,
    max: base?.max ?? null as number | null,
    scale: base?.scale ?? "",
  });
  const [ranges, setRanges] = useState<RangeForm>(() => {
    const out: RangeForm = {};
    for (const m of METHODS) {
      const r = base?.methods?.[m];
      out[m] = { low: r?.low ?? null, high: r?.high ?? null };
    }
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setError(null);
    let grindRanges: GrindRanges | null = null;
    if (f.type === "grinder") {
      const err = validateRanges(ranges);
      if (err) return setError(err);
      const methods: GrindRanges["methods"] = {};
      for (const m of METHODS) {
        const r = ranges[m];
        if (r && r.low != null && r.high != null) methods[m] = { low: r.low, high: r.high };
      }
      grindRanges = Object.keys(methods).length
        ? { methods, step: f.step, min: f.min, max: f.max, scale: f.scale || undefined,
            notation: base?.notation, dialDivisor: base?.dialDivisor ?? null, notes: base?.notes }
        : null;
    }
    const body = {
      name: f.name, type: f.type, brand: f.brand || null, details: f.details || null,
      units: f.type === "grinder" ? f.units || null : null, burrs: f.type === "grinder" ? f.burrs || null : null,
      espressoCapable: f.type === "grinder" ? f.espressoCapable : null,
      variants: f.type === "brewer" ? f.variants.split(",").map((s) => s.trim()).filter(Boolean) : null,
      defaultMethod: f.type === "brewer" ? f.defaultMethod : null, grindRanges,
      category: f.category || null,
    };
    try {
      if (item) await api.put(`/api/gear/${item.id}`, body);
      else await api.post("/api/gear", body);
      await reload(["gear", "recipes"]);
      toast(`${f.name} saved`);
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const remove = async () => {
    if (!item) return;
    const n = recipes.filter((r) => r.brewerId === item.id || r.grinderId === item.id).length;
    if (!confirm(`Remove ${item.name}?${n ? ` ${n} recipe(s) keep working with the recorded name "${item.name}".` : ""}`)) return;
    const ok = await act(async () => {
      await api.del(`/api/gear/${item.id}`);
      await reload(["gear", "recipes", "brews"]);
    }, `${item.name} removed`);
    if (ok) onClose();
  };

  return (
    <FullScreen title={item ? `Edit ${item.name}` : "Add gear"} onClose={onClose}
      footer={<div className="row">{item && <button className="danger" onClick={remove}>Remove</button>}<button onClick={onClose}>Cancel</button><button className="primary grow" onClick={save}>Save</button></div>}>
      <div className="stack form">
        <div className="grid2">
          <Field label="Name" htmlFor="ge-name"><input id="ge-name" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Type" htmlFor="ge-type">
            <select id="ge-type" value={f.type} onChange={(e) => set("type", e.target.value as GearT["type"])}>
              <option value="grinder">Grinder</option><option value="brewer">Brewer</option><option value="other">Other</option>
            </select>
          </Field>
        </div>
        <Field label="Kind" htmlFor="ge-cat" hint="Lets Brewlab suggest recipes that fit it.">
          <select id="ge-cat" value={f.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">—</option>
            {Object.entries(CATEGORY_LABELS)
              .filter(([c]) => (f.type === "grinder") === c.endsWith("grinder") || c === "other")
              .map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </Field>
        <Field label="Brand" htmlFor="ge-brand"><input id="ge-brand" value={f.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
        <Field label="Details" htmlFor="ge-details" hint={f.type === "grinder" ? "Free text — e.g. microns per click (a note only; the converter doesn't use it)." : undefined}>
          <textarea id="ge-details" rows={2} value={f.details} onChange={(e) => set("details", e.target.value)} />
        </Field>
        {f.type === "grinder" && (
          <>
            <div className="grid2">
              <Field label="Adjustment units" htmlFor="ge-units">
                <select id="ge-units" value={f.units} onChange={(e) => set("units", e.target.value)}>
                  <option value="clicks">clicks</option><option value="rotations">rotations</option><option value="">numbered settings</option>
                </select>
              </Field>
              <Field label="Espresso-capable" htmlFor="ge-esp">
                <select id="ge-esp" value={f.espressoCapable == null ? "" : f.espressoCapable ? "yes" : "no"} onChange={(e) => set("espressoCapable", e.target.value === "" ? null : e.target.value === "yes")}>
                  <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </Field>
            </div>
            <Field label="Burrs" htmlFor="ge-burrs"><input id="ge-burrs" value={f.burrs} onChange={(e) => set("burrs", e.target.value)} /></Field>
            <h3>Grind ranges</h3>
            {item?.library?.hasRanges && (
              <div className="note small" data-testid="library-ranges">
                From the gear library ({item.library.confidence}){item.library.note ? ` — ${item.library.note}` : ""}
                {item.library.source && <> <a href={item.library.source} target="_blank" rel="noreferrer noopener">Source ↗</a></>}
                {item.library.rangesDiffer && (
                  <div><button className="link" onClick={() => act(async () => {
                    await api.post(`/api/gear/${item.id}/reset-ranges`);
                    await reload(["gear"]);
                    onClose();
                  }, "Ranges reset to the library's")}>Your ranges differ from the library — reset to library ranges</button></div>
                )}
              </div>
            )}
            <p className="hint">Starting low/high for each brew method in this grinder's own units. Optional per method — leave both empty if you don't know yet. The converter maps settings by position inside these ranges.</p>
            <div className="ranges">
              {METHODS.map((m) => (
                <div key={m} className="range-row">
                  <span className="rl">{METHOD_LABELS[m]}</span>
                  <NumInput aria-label={`${METHOD_LABELS[m]} low`} placeholder="low" value={ranges[m]?.low ?? null} decimals={3}
                    onChange={(n) => setRanges((r) => ({ ...r, [m]: { ...r[m], low: n, high: r[m]?.high ?? null } }))} />
                  <NumInput aria-label={`${METHOD_LABELS[m]} high`} placeholder="high" value={ranges[m]?.high ?? null} decimals={3}
                    onChange={(n) => setRanges((r) => ({ ...r, [m]: { ...r[m], high: n, low: r[m]?.low ?? null } }))} />
                </div>
              ))}
            </div>
            <div className="grid3">
              <Field label="Step (rounding)" htmlFor="ge-step"><NumInput id="ge-step" value={f.step} onChange={(n) => set("step", n)} decimals={3} /></Field>
              <Field label="Physical min" htmlFor="ge-min"><NumInput id="ge-min" value={f.min} onChange={(n) => set("min", n)} decimals={2} /></Field>
              <Field label="Physical max" htmlFor="ge-max"><NumInput id="ge-max" value={f.max} onChange={(n) => set("max", n)} decimals={2} /></Field>
            </div>
            <Field label="Scale description" htmlFor="ge-scale"><input id="ge-scale" value={f.scale} onChange={(e) => set("scale", e.target.value)} /></Field>
          </>
        )}
        {f.type === "brewer" && (
          <>
            <Field label="Basket sizes / variants (comma-separated)" htmlFor="ge-var"><input id="ge-var" value={f.variants} onChange={(e) => set("variants", e.target.value)} /></Field>
            <Field label="Default brew method" htmlFor="ge-dm">
              <select id="ge-dm" value={f.defaultMethod ?? ""} onChange={(e) => set("defaultMethod", (e.target.value || null) as Method | null)}>
                <option value="">—</option>
                {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
              </select>
            </Field>
          </>
        )}
        <ErrorBox error={error} />
        {item && (
          <div className="suggest-row">
            <button className="link" onClick={() => setSuggesting(true)} data-testid="suggest-open">
              {item.catalogId ? "Suggest a change to the gear library…" : "Suggest this gear to the library…"}
            </button>
          </div>
        )}
      </div>
      {suggesting && item && <SuggestToLibrary item={item} onClose={() => setSuggesting(false)} />}
    </FullScreen>
  );
}

/* ------------------------------ Suggest to the library ------------------------------ */

interface LibraryEntry { kind: "new" | "update"; id: string; file: string; json: string; issues: string[]; githubUrl: string; repo: string }

/** Builds a ready-to-submit library entry from this gear (saved values). Nothing is sent anywhere. */
function SuggestToLibrary({ item, onClose }: { item: GearT; onClose: () => void }) {
  const { toast } = useData();
  const [confidence, setConfidence] = useState("manufacturer");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [entry, setEntry] = useState<LibraryEntry | null>(null);
  const hasRanges = item.type === "grinder" && Boolean(item.grindRanges && Object.keys(item.grindRanges.methods ?? {}).length);
  useEffect(() => {
    const t = setTimeout(() => {
      api.post<LibraryEntry>(`/api/gear/${encodeURIComponent(item.id)}/library-entry`, { confidence, source, note }).then(setEntry).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [item.id, confidence, source, note]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entry!.json);
      toast("Copied");
    } catch {
      toast("Couldn't copy — select the text instead", "err");
    }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([entry!.json], { type: "application/json" }));
    a.download = `${entry!.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const ready = entry && entry.issues.length === 0;
  return (
    <FullScreen title="Suggest to the gear library" onClose={onClose}>
      <div className="stack form" data-testid="suggest">
        <p className="small">
          {entry?.kind === "update"
            ? <>Proposes your grind ranges for <strong>{entry.id}</strong> in the shared gear library, so everyone adding it gets them.</>
            : <>Turns <strong>{item.name}</strong> into a library entry, so anyone can add it from the library.</>}{" "}
          It uses this gear's <em>saved</em> values. Nothing is sent from Brewlab — you submit it on GitHub.
        </p>
        {hasRanges && (
          <>
            <p className="muted small">Grind ranges need a source anyone can check — the manufacturer's manual or chart, or a published community chart. Only per-method settings the source actually states.</p>
            <Field label="Where the ranges come from" htmlFor="sg-conf">
              <select id="sg-conf" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                <option value="manufacturer">The manufacturer (manual, chart, website)</option>
                <option value="community">A published community chart</option>
              </select>
            </Field>
            <Field label="Source link" htmlFor="sg-source">
              <input id="sg-source" type="url" inputMode="url" placeholder="https://…" value={source} onChange={(e) => setSource(e.target.value)} autoCapitalize="off" spellCheck={false} />
            </Field>
            <Field label="What the source says (optional)" htmlFor="sg-note">
              <textarea id="sg-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Pour-over 22–28 clicks, espresso 7–12." />
            </Field>
          </>
        )}
        {!entry && <p className="muted">Preparing…</p>}
        {entry && (
          <>
            {ready ? (
              <p className="ok-note small" data-testid="suggest-ready">✓ Ready — this passes the library's checks.</p>
            ) : (
              <div className="error small" data-testid="suggest-issues">
                <strong>Before it can be submitted:</strong>
                <ul className="plain">{entry.issues.map((i) => <li key={i}>{i}</li>)}</ul>
              </div>
            )}
            <div className="small muted"><code>{entry.file}</code></div>
            <pre className="prompt" data-testid="suggest-json">{entry.json}</pre>
            <div className="row-actions">
              <button onClick={copy}>Copy</button>
              <button onClick={download}>Download</button>
              <a className={`button primary ${ready ? "" : "disabled"}`} href={ready ? entry.githubUrl : undefined} aria-disabled={!ready}
                target="_blank" rel="noreferrer noopener" data-testid="suggest-github">
                {entry.kind === "new" ? "Open on GitHub" : "Edit on GitHub"}
              </a>
            </div>
            <p className="muted small">
              {entry.kind === "new"
                ? <>GitHub opens a new file in <code>{entry.repo}</code> with this content filled in — then “Propose new file” makes a pull request (GitHub forks the repo for you).</>
                : <>GitHub opens <code>{entry.file}</code> for editing — paste this over it, then “Propose changes”.</>}{" "}
              Needs a free GitHub account. See CONTRIBUTING.md in the repo.
            </p>
          </>
        )}
      </div>
    </FullScreen>
  );
}

/* ------------------------------ Gear library picker ------------------------------ */

interface LibGear {
  id: string; name: string; brand: string | null; type: "grinder" | "brewer" | "other"; category: string;
  units: string | null; hasRanges: boolean; methods: string[]; confidence: string | null; owned: boolean;
}

/** Add gear from the built-in library (an editable copy), or start a custom item. */
function LibraryPicker({ onClose, onCustom }: { onClose: () => void; onCustom: () => void }) {
  const { reload, act } = useData();
  const [items, setItems] = useState<LibGear[] | null>(null);
  const [q, setQ] = useState("");
  const load = () => api.get<{ gear: LibGear[] }>("/api/catalog").then((c) => setItems(c.gear));
  useEffect(() => {
    load().catch(() => setItems([]));
  }, []);
  const add = (g: LibGear) =>
    act(async () => {
      await api.post("/api/gear/from-catalog", { catalogId: g.id });
      await reload(["gear"]);
      await load();
    }, `Added ${g.name}`);
  const needle = q.trim().toLowerCase();
  const shown = (items ?? []).filter((g) => !needle || `${g.name} ${g.brand ?? ""} ${g.category}`.toLowerCase().includes(needle));
  const groups = Object.keys(CATEGORY_LABELS).map((c) => [c, shown.filter((g) => g.category === c)] as const).filter(([, gs]) => gs.length);
  return (
    <FullScreen title="Add gear" onClose={onClose}
      footer={<button className="block" onClick={onCustom}>Add custom gear</button>}>
      <div className="stack" data-testid="gear-library">
        <p className="hint">Pick from the library — you get your own copy, editable like any gear. Not listed? Add custom gear below.</p>
        <SearchInput placeholder="Search grinders, brewers…" label="Search the gear library" value={q} onChange={setQ} />
        {!items && <p className="muted">Loading…</p>}
        {items && shown.length === 0 && <p className="muted">Nothing in the library matches — add it as custom gear.</p>}
        {groups.map(([cat, gs]) => (
          <section key={cat}>
            <h2 className="group">{CATEGORY_LABELS[cat]}</h2>
            <ul className="lib-list">
              {gs.map((g) => (
                <li key={g.id} data-lib={g.id}>
                  <div className="lib-main">
                    <strong>{g.name}</strong>
                    <span className="muted small">
                      {g.type === "grinder"
                        ? g.hasRanges ? `Grind ranges for ${g.methods.length} method${g.methods.length === 1 ? "" : "s"}${g.confidence ? ` · ${g.confidence}` : ""}` : "No grind ranges yet — you can add your own"
                        : g.brand ?? ""}
                    </span>
                  </div>
                  {g.owned ? (
                    <button className="small-btn" onClick={() => add(g)} aria-label={`Add another ${g.name}`}>✓ Added · add another</button>
                  ) : (
                    <button className="primary small-btn" onClick={() => add(g)} aria-label={`Add ${g.name}`}>Add</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </FullScreen>
  );
}
