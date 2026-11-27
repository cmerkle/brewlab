import { useEffect, useState } from "react";
import { CATEGORY_LABELS, GearLibraryBrowser, type LibGear, type GearTab } from "../GearLibrary";
import { api, type Gear as GearT, type RangeInfo } from "../api";
import { useData, Field, FullScreen, ErrorBox, NumInput, useAction, usePref } from "../ui";
import { METHODS, METHOD_LABELS, CATEGORY_METHOD, validateRanges, type Method, type GrindRanges } from "../../shared/grind";
import { estimateRanges, estimateNoteFor, type EstimateRules } from "../../shared/estimate";

const TYPES = [
  { id: "grinder", label: "Grinders" },
  { id: "brewer", label: "Brewers" },
  // Retired type: older installs may still hold some; shown only then, so they can be removed.
  { id: "other", label: "Other" },
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
        if (t.id === "other" && items.length === 0) return null;
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
                        {g.grindRanges?.unsupported?.length ? ` · can't do ${g.grindRanges.unsupported.map((m) => METHOD_LABELS[m]).join(", ")}` : ""}
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
    variants: (item?.variants ?? []).join(", "),
    defaultMethod: (item?.defaultMethod ?? null) as Method | null,
    category: (item?.category ?? "") as string,
    step: base?.step ?? null as number | null,
    min: base?.min ?? null as number | null,
    max: base?.max ?? null as number | null,
    scale: base?.scale ?? "",
    notation: (base?.notation ?? "decimal") as "decimal" | "thirds",
    dialDivisor: base?.dialDivisor ?? null as number | null,
  });
  // Brew methods this grinder can do (unticked = can't; its range is dropped on save).
  const [cannot, setCannot] = useState<Method[]>(() => [...(base?.unsupported ?? [])]);
  // Per-method notes (e.g. "can't do espresso", "the maker groups moka with AeroPress").
  const [notes, setNotes] = useState<Partial<Record<Method, string>>>(() => ({ ...(base?.notes ?? {}) }));
  const [ranges, setRanges] = useState<RangeForm>(() => {
    const out: RangeForm = {};
    for (const m of METHODS) {
      const r = base?.methods?.[m];
      out[m] = { low: r?.low ?? null, high: r?.high ?? null };
    }
    return out;
  });
  const [info, setInfo] = useState<RangeInfo>(() => ({ ...(item?.rangeInfo ?? {}), estimated: item?.rangeInfo?.estimated ?? [] }));
  const setRange = (m: Method, patch: { low?: number | null; high?: number | null }) => {
    setRanges((r) => ({ ...r, [m]: { low: r[m]?.low ?? null, high: r[m]?.high ?? null, ...patch } }));
    // A range you type yourself is no longer the library's estimate.
    setInfo((i) => (i.estimated?.includes(m) ? { ...i, estimated: i.estimated.filter((x) => x !== m) } : i));
  };
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  // "Estimate the empty rows": the library's rules (catalog/estimate-rules.json) applied to this
  // grinder's other ranges. Fills ticked rows that have no range, marks them est., explains how.
  const [estimateMsg, setEstimateMsg] = useState<string | null>(null);
  const emptyRows = METHODS.filter((m) => !cannot.includes(m) && ranges[m]?.low == null && ranges[m]?.high == null);
  const filledRows = METHODS.filter((m) => !cannot.includes(m) && ranges[m]?.low != null && ranges[m]?.high != null);
  const estimate = async () => {
    setEstimateMsg(null);
    let rules: EstimateRules;
    try {
      rules = await api.get<EstimateRules>("/api/catalog/estimate-rules");
    } catch (e: any) {
      return setEstimateMsg(e.message);
    }
    const methods: GrindRanges["methods"] = {};
    for (const m of filledRows) methods[m] = { low: ranges[m]!.low!, high: ranges[m]!.high! };
    const r = estimateRanges({ methods, step: f.step, min: f.min, max: f.max, notation: f.notation, unsupported: cannot }, emptyRows, rules);
    const made = METHODS.filter((m) => r.methods[m]);
    setRanges((x) => {
      const next = { ...x };
      for (const m of made) next[m] = { low: r.methods[m]!.low, high: r.methods[m]!.high };
      return next;
    });
    if (made.length) {
      setInfo((i) => {
        const fresh = [...new Set(made.map((m) => r.notes[m]!))].filter((n) => !(i.estimateNote ?? "").includes(n));
        const old = i.estimateNote?.trim() ?? "";
        let note = old;
        if (!old) note = estimateNoteFor(fresh, rules);
        else if (fresh.length && old.endsWith(rules.noteSuffix)) note = `${old.slice(0, -rules.noteSuffix.length)}; ${fresh.join("; ")}${rules.noteSuffix}`;
        else if (fresh.length) note = `${old} ${estimateNoteFor(fresh, rules)}`;
        return { ...i, estimated: METHODS.filter((m) => made.includes(m) || i.estimated?.includes(m)), estimateNote: note };
      });
    }
    const needs = (alts: Method[][]) => alts.length
      ? `needs ${alts.map((a) => a.map((n) => METHOD_LABELS[n]).join(" and ")).join(", or ")}`
      : "no rule for it — type a range";
    const missing = METHODS.filter((m) => r.missing[m]).map((m) => `${METHOD_LABELS[m]} (${needs(r.missing[m]!)})`);
    setEstimateMsg(
      [made.length ? `Estimated ${made.map((m) => METHOD_LABELS[m]).join(", ")} — marked est.; check them and Save.` : "Nothing could be estimated.",
        missing.length ? `Couldn't estimate ${missing.join(", ")}.` : ""].filter(Boolean).join(" "),
    );
  };
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setError(null);
    if (f.type === "brewer" && !f.defaultMethod) return setError("Choose a grind category — it says which grind range this brewer uses.");
    let grindRanges: GrindRanges | null = null;
    if (f.type === "grinder") {
      const err = validateRanges(ranges);
      if (err) return setError(err);
      const methods: GrindRanges["methods"] = {};
      for (const m of METHODS) {
        const r = ranges[m];
        if (r && r.low != null && r.high != null && !cannot.includes(m)) methods[m] = { low: r.low, high: r.high };
      }
      const cleanNotes: GrindRanges["notes"] = {};
      for (const m of METHODS) if (notes[m]?.trim()) cleanNotes[m] = notes[m]!.trim();
      const unsupported = METHODS.filter((m) => cannot.includes(m));
      grindRanges = Object.keys(methods).length || unsupported.length
        ? { methods, ...(unsupported.length ? { unsupported } : {}), step: f.step, min: f.min, max: f.max, scale: f.scale || undefined,
            notation: f.notation === "thirds" ? "thirds" : undefined, dialDivisor: f.dialDivisor,
            notes: Object.keys(cleanNotes).length ? cleanNotes : undefined }
        : null;
    }
    const body = {
      name: f.name, type: f.type, brand: f.brand || null, details: f.details || null,
      units: f.type === "grinder" ? f.units || null : null, burrs: f.type === "grinder" ? f.burrs || null : null,
      variants: f.type === "brewer" ? f.variants.split(",").map((s) => s.trim()).filter(Boolean) : null,
      defaultMethod: f.type === "brewer" ? f.defaultMethod : null, grindRanges,
      category: f.category || null,
      ...(f.type === "grinder"
        ? { rangeInfo: {
            confidence: info.confidence ?? null,
            source: info.source?.trim() || null, note: info.note?.trim() || null,
            estimated: (info.estimated ?? []).filter((m) => !cannot.includes(m)), estimateNote: info.estimateNote ?? null,
          } }
        : {}),
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
              <option value="grinder">Grinder</option><option value="brewer">Brewer</option>{f.type === "other" && <option value="other">Other</option>}
            </select>
          </Field>
        </div>
        <Field label="Kind" htmlFor="ge-cat" hint="Lets Brewlab suggest recipes that fit it.">
          <select id="ge-cat" value={f.category} onChange={(e) => {
            const c = e.target.value;
            // The kind suggests the grind category, unless one was chosen by hand.
            setF((x) => ({ ...x, category: c, defaultMethod: !x.defaultMethod || x.defaultMethod === CATEGORY_METHOD[x.category] ? CATEGORY_METHOD[c] ?? x.defaultMethod : x.defaultMethod }));
          }}>
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
            <Field label="Adjustment units" htmlFor="ge-units">
              <select id="ge-units" value={f.units} onChange={(e) => set("units", e.target.value)}>
                <option value="clicks">clicks</option><option value="rotations">rotations</option><option value="">numbered settings</option>
              </select>
            </Field>
            <Field label="Burrs" htmlFor="ge-burrs"><input id="ge-burrs" value={f.burrs} onChange={(e) => set("burrs", e.target.value)} /></Field>
            <h3>Grind ranges</h3>
            {item?.library?.hasRanges && !item.library.rangesDiffer && <p className="hint" data-testid="library-same">Same as the gear library's entry.</p>}
            {item?.library?.hasRanges && item.library.rangesDiffer && (
              <div className="note small" data-testid="library-ranges">
                {item.library.rangesDiffer && (
                  <div><button className="link" onClick={() => act(async () => {
                    await api.post(`/api/gear/${item.id}/reset-ranges`);
                    await reload(["gear"]);
                    onClose();
                  }, "Ranges reset to the library's")}>Your ranges differ from the library — reset to library ranges</button></div>
                )}
              </div>
            )}
            <p className="hint">Tick the brew methods this grinder can do, with a starting low/high in its own units (leave both empty if you don't know yet). The converter maps settings by position inside these ranges.</p>
            <div className="ranges" data-testid="range-table">
              {METHODS.map((m) => (
                <div key={m} className="range-row" data-method={m}>
                  <label className="rl">
                    <input type="checkbox" aria-label={`Can do ${METHOD_LABELS[m]}`} checked={!cannot.includes(m)}
                      onChange={(e) => setCannot((c) => (e.target.checked ? c.filter((x) => x !== m) : [...c, m]))} />
                    <span>
                      {METHOD_LABELS[m]}
                      {info.estimated?.includes(m) && !cannot.includes(m) && <span className="est-badge" title="Estimated — extrapolated, not from the source">est.</span>}
                    </span>
                  </label>
                  {cannot.includes(m) ? (
                    <span className="muted small cant">Can't do</span>
                  ) : (
                    <>
                      <NumInput aria-label={`${METHOD_LABELS[m]} low`} placeholder="low" value={ranges[m]?.low ?? null} decimals={3}
                        onChange={(n) => setRange(m, { low: n })} />
                      <NumInput aria-label={`${METHOD_LABELS[m]} high`} placeholder="high" value={ranges[m]?.high ?? null} decimals={3}
                        onChange={(n) => setRange(m, { high: n })} />
                    </>
                  )}
                  <textarea className="range-note" aria-label={`${METHOD_LABELS[m]} note`} placeholder="+ note" value={notes[m] ?? ""}
                    rows={Math.max(1, Math.ceil((notes[m]?.length ?? 0) / 42))}
                    onChange={(e) => setNotes((x) => ({ ...x, [m]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="stack-sm" data-testid="estimate">
              <button type="button" onClick={estimate} disabled={!emptyRows.length || !filledRows.length}>Estimate the empty rows</button>
              <p className="hint">
                {emptyRows.length && filledRows.length
                  ? `Fills ${emptyRows.map((m) => METHOD_LABELS[m]).join(", ")} from this grinder's other ranges, using the gear library's rules (e.g. cold brew = the French press range moved half its width coarser). Marked est.`
                  : !filledRows.length ? "Enter at least one range to estimate the others from." : "Every ticked row has a range."}
              </p>
              {estimateMsg && <p className="note small" role="status" data-testid="estimate-result">{estimateMsg}</p>}
            </div>
            <Field label="Where these ranges come from" htmlFor="ge-confidence">
              <select id="ge-confidence" value={info.confidence ?? ""} onChange={(e) => setInfo((i) => ({ ...i, confidence: (e.target.value || null) as RangeInfo["confidence"] }))}>
                <option value="">My own (measured or dialled in)</option>
                <option value="manufacturer">The maker's chart or manual</option>
                <option value="community">A community chart</option>
              </select>
            </Field>
            <Field label="Source link" htmlFor="ge-source" hint="The maker's manual or chart, or the community chart.">
              <input id="ge-source" type="url" inputMode="url" placeholder="https://…" value={info.source ?? ""} onChange={(e) => setInfo((i) => ({ ...i, source: e.target.value }))} />
            </Field>
            <Field label="Notes about these ranges" htmlFor="ge-source-note">
              <textarea id="ge-source-note" rows={2} value={info.note ?? ""} onChange={(e) => setInfo((i) => ({ ...i, note: e.target.value }))} />
            </Field>
            <fieldset className="checks" data-testid="estimated-rows">
              <legend>Estimated rows <span className="muted small">(worked out from the others, not from the source — shown as “est.”)</span></legend>
              {METHODS.filter((m) => !cannot.includes(m) && ranges[m]?.low != null && ranges[m]?.high != null).map((m) => (
                <label key={m} className="check">
                  <input type="checkbox" aria-label={`${METHOD_LABELS[m]} is estimated`} checked={Boolean(info.estimated?.includes(m))}
                    onChange={(e) => setInfo((i) => ({ ...i, estimated: e.target.checked ? METHODS.filter((x) => x === m || i.estimated?.includes(x)) : (i.estimated ?? []).filter((x) => x !== m) }))} />
                  {METHOD_LABELS[m]}
                </label>
              ))}
            </fieldset>
            {(info.estimated?.length ?? 0) > 0 && (
              <Field label="How the estimates were worked out" htmlFor="ge-estimate-note">
                <textarea id="ge-estimate-note" rows={2} value={info.estimateNote ?? ""} onChange={(e) => setInfo((i) => ({ ...i, estimateNote: e.target.value }))} />
              </Field>
            )}
            <div className="grid3">
              <Field label="Step (rounding)" htmlFor="ge-step" hint="1 click, 0.1 rotation, 1/3 for thirds."><NumInput id="ge-step" value={f.step} onChange={(n) => set("step", n)} decimals={3} fractions /></Field>
              <Field label="Physical min" htmlFor="ge-min"><NumInput id="ge-min" value={f.min} onChange={(n) => set("min", n)} decimals={2} /></Field>
              <Field label="Physical max" htmlFor="ge-max"><NumInput id="ge-max" value={f.max} onChange={(n) => set("max", n)} decimals={2} /></Field>
            </div>
            <Field label="Scale description" htmlFor="ge-scale"><input id="ge-scale" value={f.scale} onChange={(e) => set("scale", e.target.value)} /></Field>
            <div className="grid2">
              <Field label="Dial notation" htmlFor="ge-notation" hint="Thirds: the digit after the point counts thirds, like the Fellow Ode (5.1 = 5⅓, 5.2 = 5⅔).">
                <select id="ge-notation" value={f.notation} onChange={(e) => set("notation", e.target.value as "decimal" | "thirds")}>
                  <option value="decimal">Decimal (5.5 = halfway)</option><option value="thirds">Thirds (5.1 = 5⅓)</option>
                </select>
              </Field>
              <Field label="Dial shows setting ÷" htmlFor="ge-divisor" hint="Note only, e.g. 10 for a dial that reads 7.2 at 72 clicks.">
                <NumInput id="ge-divisor" value={f.dialDivisor} onChange={(n) => set("dialDivisor", n)} decimals={2} />
              </Field>
            </div>
          </>
        )}
        {f.type === "brewer" && (
          <>
            <Field label="Basket sizes / variants (comma-separated)" htmlFor="ge-var"><input id="ge-var" value={f.variants} onChange={(e) => set("variants", e.target.value)} /></Field>
            <Field label="Grind category" htmlFor="ge-dm" hint="Which grind range on your grinders this brewer uses. Recipes can still pick another (e.g. a Switch as pour-over).">
              <select id="ge-dm" value={f.defaultMethod ?? ""} onChange={(e) => set("defaultMethod", (e.target.value || null) as Method | null)}>
                <option value="" disabled>Choose…</option>
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
  const [confidence, setConfidence] = useState<string>(item.rangeInfo?.confidence ?? "manufacturer");
  const [source, setSource] = useState(item.rangeInfo?.source ?? "");
  const [note, setNote] = useState(item.rangeInfo?.note ?? "");
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


/** Add gear from the built-in library (an editable copy), or start a custom item. */
function LibraryPicker({ onClose, onCustom }: { onClose: () => void; onCustom: () => void }) {
  const { reload, act } = useData();
  const [items, setItems] = useState<LibGear[] | null>(null);
  const [tab, setTab] = usePref<GearTab>("gearLibraryTab", "brewer");
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
  return (
    <FullScreen title="Add gear" onClose={onClose}
      footer={<button className="block" onClick={onCustom}>Add custom gear</button>}>
      <div className="stack" data-testid="gear-library">
        <p className="hint">Pick from the library — you get your own copy, editable like any gear. Not listed? Add custom gear below.</p>
        <GearLibraryBrowser items={items} tab={tab} onTab={setTab} emptyHint="Nothing in the library matches — add it as custom gear."
          row={(g) => (
            <>
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
            </>
          )} />
      </div>
    </FullScreen>
  );
}
