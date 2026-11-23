import { useMemo, useState } from "react";
import { api, ApiError, type Recipe } from "../api";
import { useData, NumInput, WaterInput, Field, FullScreen, ErrorBox, getPref, setPref, useAction, SearchInput, Glyph, useTemp, TempInput } from "../ui";
import { GrinderSwitcher, methodOf } from "../grindui";
import { ScaleDialog, planFromRecipe, StepList, type BrewPlan } from "./ScaleDialog";
import { fmtRatio, ratioOf, type Step } from "../../shared/brew";
import { METHODS, METHOD_LABELS, type Method } from "../../shared/grind";

export function Recipes({ onEditGrinder }: { onEditGrinder: (id: string) => void }) {
  const { recipes, loaded } = useData();
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [brewing, setBrewing] = useState<BrewPlan | null>(null);
  const [editing, setEditing] = useState<Recipe | "new" | null>(null);
  useAction("new-recipe", () => setEditing("new"));

  const brewers = useMemo(() => {
    const ids = new Map<string, string>();
    for (const r of recipes) ids.set(r.brewerId ?? `name:${r.brewerName ?? "Other"}`, r.brewerName ?? "Other");
    return [...ids.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [recipes]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return recipes.filter((r) => {
      const key = r.brewerId ?? `name:${r.brewerName ?? "Other"}`;
      if (filter !== "all" && key !== filter) return false;
      if (!needle) return true;
      return [r.name, r.coffee, r.brewerName, r.grinderName].some((x) => x?.toLowerCase().includes(needle));
    });
  }, [recipes, filter, q]);
  const favorites = visible.filter((r) => r.favorite);
  const groups = useMemo(() => {
    const g = new Map<string, Recipe[]>();
    for (const r of visible) {
      if (r.favorite) continue;
      const key = r.brewerId ?? `name:${r.brewerName ?? "Other"}`;
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(r);
    }
    // Your own recipes first within each brewer, then starters.
    for (const list of g.values()) list.sort((a, b) => Number(a.starter) - Number(b.starter) || a.name.localeCompare(b.name));
    return [...g.entries()].sort((a, b) => (a[1][0].brewerName ?? "").localeCompare(b[1][0].brewerName ?? ""));
  }, [visible]);

  const card = (r: Recipe) => <RecipeCard key={r.id} r={r} onBrew={(p) => setBrewing(p)} onEdit={() => setEditing(r)} onEditGrinder={onEditGrinder} />;
  return (
    <div className="stack">
      <div className="toolbar">
        <SearchInput placeholder="Search recipes, coffee, brewer" label="Search recipes" value={q} onChange={setQ} />
        <select className="pill-select" aria-label="Filter by brewer" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All brewers</option>
          {brewers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      {!loaded && <p className="muted">Loading…</p>}
      {loaded && visible.length === 0 && <p className="muted">{recipes.length ? "No recipes match." : "No recipes yet."}</p>}
      {favorites.length > 0 && (
        <section>
          <h2 className="group">★ Favorites</h2>
          <div className="rows">{favorites.map(card)}</div>
        </section>
      )}
      {groups.map(([key, rs]) => (
        <section key={key}>
          <h2 className="group">{rs[0].brewerName ?? "Other"}</h2>
          <div className="rows">{rs.map(card)}</div>
        </section>
      ))}
      {brewing && <ScaleDialog plan={brewing} onClose={() => setBrewing(null)} onEditGrinder={(id) => { setBrewing(null); onEditGrinder(id); }} />}
      {editing && <RecipeEditor recipe={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Compact row that expands on tap; Brew is always one tap away. */
export function RecipeCard({ r, onBrew, onEdit, onEditGrinder, startOpen = false }: { r: Recipe; onBrew: (p: BrewPlan) => void; onEdit?: () => void; onEditGrinder?: (id: string) => void; startOpen?: boolean }) {
  const { reload, toast, bags, gear, act } = useData();
  const temp = useTemp();
  const prefKey = `grinder.recipe.${r.id}`;
  const [grinderId, setGrinderIdRaw] = useState<string | null>(() => {
    const saved = getPref<string | null>(prefKey, null);
    return saved && gear.some((g) => g.id === saved) ? saved : r.grinderId;
  });
  const setGrinderId = (id: string) => {
    setGrinderIdRaw(id);
    setPref(prefKey, id);
  };
  const [open, setOpen] = useState(startOpen);
  const bag = bags.find((b) => b.id === r.inventoryId);
  const espresso = methodOf(r, gear) === "espresso";

  const copy = async () => {
    try {
      const c = await api.post<Recipe>(`/api/recipes/${r.id}/copy`);
      await reload(["recipes"]);
      toast(`Saved "${c.name}"`);
    } catch (e: any) {
      toast(e instanceof ApiError && e.status === 409 ? e.message : `Copy failed: ${e.message}`, e.status === 409 ? "ok" : "err");
    }
  };
  const del = async () => {
    if (!confirm(`Delete "${r.name}"? Brews made with it keep their recipe name.`)) return;
    await act(async () => {
      await api.del(`/api/recipes/${r.id}`);
      await reload(["recipes", "brews"]);
    }, "Recipe deleted");
  };
  const fav = () =>
    act(async () => {
      await api.patch(`/api/recipes/${r.id}/favorite`, { favorite: !r.favorite });
      await reload(["recipes"]);
    });
  return (
    <article className={`card recipe ${open ? "open" : ""}`} data-testid={`recipe-${r.id}`}>
      <div className="row-head">
        <button className="row-main" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="recipe-toggle">
          <span className="row-title">{r.name}</span>
          <span className="row-sub">
            {r.brewerName ?? "—"}{!r.brewerId && r.brewerName ? " (removed)" : ""} · {r.doseG} g / {r.waterG} g · {fmtRatio(ratioOf(r.doseG, r.waterG))}
          </span>
        </button>
        <button className={`star ${r.favorite ? "on" : ""}`} aria-pressed={r.favorite} aria-label={r.favorite ? "Remove from favorites" : "Add to favorites"} onClick={fav}><Glyph name="star" filled={r.favorite} size={22} /></button>
        <button className="primary small-btn" data-testid="recipe-brew" onClick={() => onBrew({ ...planFromRecipe(r), selectedGrinderId: grinderId })}>Brew</button>
      </div>
      {open && (
        <div className="row-body">
          <dl className="facts">
            <div><dt>Brewer</dt><dd>{r.brewerName ?? "—"}{!r.brewerId && r.brewerName ? " (removed from gear)" : ""}</dd></div>
            <div><dt>Dose</dt><dd>{r.doseG} g</dd></div>
            <div><dt>{espresso ? "Yield" : "Water"}</dt><dd>{r.waterG} g</dd></div>
            <div><dt>Ratio</dt><dd>{fmtRatio(ratioOf(r.doseG, r.waterG))}</dd></div>
            <div><dt>Temp</dt><dd>{r.tempC != null ? temp.fmt(r.tempC) : "—"}</dd></div>
            <div><dt>Grind</dt><dd>{r.grinderName ?? "—"}: {r.grindSetting ?? "—"}</dd></div>
          </dl>
          {(r.coffee || bag) && <div className="muted">Coffee: {bag ? `${bag.name} (from Stash)` : r.coffee}</div>}
          <GrinderSwitcher recipe={r} value={grinderId} onChange={setGrinderId} idPrefix={`rc${r.id}`} onEditGrinder={onEditGrinder} />
          <StepList steps={r.steps} />
          {r.notes && <p className="muted small">{r.notes}</p>}
          <div className="row wrap">
            <button className="primary" onClick={() => onBrew({ ...planFromRecipe(r), selectedGrinderId: grinderId })}>Brew</button>
            <button onClick={copy}>Copy Recipe</button>
            {onEdit && <button onClick={onEdit}>Edit</button>}
            {onEdit && <button className="danger" onClick={del}>Delete</button>}
          </div>
        </div>
      )}
    </article>
  );
}

/* ------------------------------ Editor ------------------------------ */

export function RecipeEditor({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const { gear, bags, limits, reload, toast } = useData();
  const temp = useTemp();
  const brewers = gear.filter((g) => g.type === "brewer");
  const grinders = gear.filter((g) => g.type === "grinder");
  const [f, setF] = useState(() => ({
    name: recipe?.name ?? "",
    brewerId: (recipe?.brewerId ?? brewers[0]?.id ?? null) as string | null,
    brewerName: recipe?.brewerName ?? null,
    method: (recipe?.method ?? null) as Method | null,
    coffee: recipe?.coffee ?? "",
    doseG: recipe?.doseG ?? 20 as number | null,
    waterG: recipe?.waterG ?? 320 as number | null,
    tempC: recipe?.tempC ?? 93 as number | null,
    grinderId: (recipe?.grinderId ?? grinders[0]?.id ?? null) as string | null,
    grinderName: recipe?.grinderName ?? null,
    grindSetting: recipe?.grindSetting ?? "",
    steps: (recipe?.steps ?? [{ label: "Pour to 320g", targetWaterG: 320, atSec: 0, detail: "" }]) as Step[],
    notes: recipe?.notes ?? "",
    inventoryId: recipe?.inventoryId ?? null as number | null,
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setStep = (i: number, patch: Partial<Step>) => set("steps", f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const effMethod = f.method ?? methodOf({ method: null, brewerId: f.brewerId }, gear);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const body = { ...f, coffee: f.coffee || null, grindSetting: f.grindSetting || null, notes: f.notes || null,
        steps: f.steps.map((s) => ({ ...s, detail: s.detail || null })) };
      if (recipe) await api.put(`/api/recipes/${recipe.id}`, body);
      else await api.post("/api/recipes", body);
      await reload(["recipes"]);
      toast("Recipe saved");
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const brewerMissing = f.brewerId && !brewers.some((b) => b.id === f.brewerId);
  return (
    <FullScreen title={recipe ? "Edit recipe" : "New recipe"} onClose={onClose}
      footer={<div className="row"><button onClick={onClose}>Cancel</button><button className="primary grow" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save recipe"}</button></div>}>
      <div className="stack form">
        <Field label="Name" htmlFor="re-name"><input id="re-name" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Brewer" htmlFor="re-brewer">
            <select id="re-brewer" value={f.brewerId ?? ""} onChange={(e) => set("brewerId", e.target.value || null)}>
              {(!f.brewerId || brewerMissing) && <option value="">{f.brewerName ?? "— none —"}{brewerMissing ? " (removed)" : ""}</option>}
              {brewers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Brew method (for grind conversion)" htmlFor="re-method">
            <select id="re-method" value={f.method ?? ""} onChange={(e) => set("method", (e.target.value || null) as Method | null)}>
              <option value="">Brewer default ({METHOD_LABELS[effMethod]})</option>
              {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid2">
          <Field label="From your inventory" htmlFor="re-bag">
            <select id="re-bag" value={f.inventoryId ?? ""} onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              const bag = bags.find((b) => b.id === id);
              setF((x) => ({ ...x, inventoryId: id, coffee: bag ? bag.name : x.coffee }));
            }}>
              <option value="">— none —</option>
              {bags.filter((b) => b.status !== "finished" || b.id === f.inventoryId).map((b) => <option key={b.id} value={b.id}>{b.name}{b.roaster ? ` — ${b.roaster}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Coffee" htmlFor="re-coffee"><input id="re-coffee" value={f.coffee} onChange={(e) => set("coffee", e.target.value)} /></Field>
        </div>
        <div className="grid3">
          <Field label="Coffee (g)" htmlFor="re-dose"><NumInput id="re-dose" value={f.doseG} onChange={(n) => set("doseG", n)} min={limits?.doseG.min} max={limits?.doseG.max} decimals={1} /></Field>
          <WaterInput id="re-water" label={effMethod === "espresso" ? "Yield" : "Water"} grams={f.waterG} onChange={(n) => set("waterG", n)} />
          <Field label={`Temp (${temp.label})`} htmlFor="re-temp"><TempInput id="re-temp" value={f.tempC} onChange={(n) => set("tempC", n)} /></Field>
        </div>
        <div className="muted">Ratio {fmtRatio(f.doseG && f.waterG ? ratioOf(f.doseG, f.waterG) : null)}</div>
        <div className="grid2">
          <Field label="Grinder" htmlFor="re-grinder">
            <select id="re-grinder" value={f.grinderId ?? ""} onChange={(e) => set("grinderId", e.target.value || null)}>
              {(!f.grinderId || !grinders.some((g) => g.id === f.grinderId)) && <option value="">{f.grinderName ?? "— none —"}</option>}
              {grinders.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="Grind setting" htmlFor="re-grind" hint="In the grinder's own units, e.g. 5.0 rotations, 72 clicks, setting 5">
            <input id="re-grind" value={f.grindSetting} onChange={(e) => set("grindSetting", e.target.value)} />
          </Field>
        </div>
        <h3>Steps</h3>
        {f.steps.map((s, i) => (
          <div key={i} className="step-edit">
            <input aria-label={`Step ${i + 1} label`} placeholder="Label" value={s.label} onChange={(e) => setStep(i, { label: e.target.value })} />
            <input aria-label={`Step ${i + 1} detail`} placeholder="Detail" value={s.detail ?? ""} onChange={(e) => setStep(i, { detail: e.target.value })} />
            <div className="grid2">
              <Field label="Target water (g, cumulative)" htmlFor={`re-st${i}`}><NumInput id={`re-st${i}`} value={s.targetWaterG} onChange={(n) => setStep(i, { targetWaterG: n })} min={0} max={limits?.targetWaterG.max} decimals={1} /></Field>
              <Field label="At (seconds)" htmlFor={`re-sa${i}`}><NumInput id={`re-sa${i}`} value={s.atSec} onChange={(n) => setStep(i, { atSec: n })} min={0} max={limits?.atSec.max} decimals={0} /></Field>
            </div>
            <button type="button" className="link danger" onClick={() => set("steps", f.steps.filter((_, j) => j !== i))}>Remove step</button>
          </div>
        ))}
        <button type="button" onClick={() => set("steps", [...f.steps, { label: "", targetWaterG: f.waterG, atSec: (f.steps.at(-1)?.atSec ?? 0) + 30, detail: "" }])}>Add step</button>
        <Field label="Notes" htmlFor="re-notes"><textarea id="re-notes" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <ErrorBox error={error} />
      </div>
    </FullScreen>
  );
}
