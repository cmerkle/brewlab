import { useMemo, useState } from "react";
import { api, type Brew } from "../api";
import { useData, Field, FullScreen, ErrorBox, NumInput, WaterInput, Stars, fmtDate, fmtTime, useAction, SearchInput, useTemp, TempInput } from "../ui";
import { ScaleDialog, planFromBrew, type BrewPlan } from "./ScaleDialog";
import { fmtRatio, ratioOf, scaleSteps } from "../../shared/brew";
import { grindLabel } from "../grindui";
import { WaterSelect } from "./Water";

export function BrewLog() {
  const { brews, recipes, bags, gear, loaded } = useData();
  const temp = useTemp();
  const [brewing, setBrewing] = useState<BrewPlan | null>(null);
  const [editing, setEditing] = useState<Brew | "new" | null>(null);
  const [coffee, setCoffee] = useState("");
  const [recipe, setRecipe] = useState("");
  const [waterF, setWaterF] = useState("");
  const [q, setQ] = useState("");
  useAction("log-brew", () => setEditing("new"));

  const coffees = useMemo(() => [...new Set(brews.map((b) => b.coffee).filter(Boolean) as string[])].sort(), [brews]);
  const recipeNames = useMemo(() => [...new Set(brews.map((b) => b.recipeName).filter(Boolean) as string[])].sort(), [brews]);
  const waterNames = useMemo(() => [...new Set(brews.map((b) => b.waterName).filter(Boolean) as string[])].sort(), [brews]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return brews.filter((b) =>
      (!coffee || b.coffee === coffee) &&
      (!recipe || b.recipeName === recipe) &&
      (!waterF || b.waterName === waterF) &&
      (!needle || [b.notes, b.recipeName, b.coffee, b.grinderName, b.waterName].some((x) => x?.toLowerCase().includes(needle))));
  }, [brews, coffee, recipe, waterF, q]);
  const stats = useMemo(() => {
    const rated = shown.filter((b) => b.rating != null);
    const avg = rated.length ? rated.reduce((a, b) => a + (b.rating ?? 0), 0) / rated.length : null;
    const grams = shown.reduce((a, b) => a + (b.doseG || 0), 0);
    return { n: shown.length, avg, grams };
  }, [shown]);
  // Average rating per coffee (for the filtered recipe, if any) — which beans worked best.
  const byCoffee = useMemo(() => {
    const m = new Map<string, { n: number; sum: number }>();
    for (const b of brews) {
      if (!b.coffee || b.rating == null || (recipe && b.recipeName !== recipe)) continue;
      const e = m.get(b.coffee) ?? { n: 0, sum: 0 };
      e.n++;
      e.sum += b.rating;
      m.set(b.coffee, e);
    }
    return [...m.entries()].map(([c, e]) => ({ coffee: c, n: e.n, avg: e.sum / e.n })).sort((a, b) => b.avg - a.avg).slice(0, 5);
  }, [brews, recipe]);
  // The same for waters (for the filtered recipe and coffee, if any) — which water suits them best.
  const byWater = useMemo(() => {
    const m = new Map<string, { n: number; sum: number }>();
    for (const b of brews) {
      if (!b.waterName || b.rating == null || (recipe && b.recipeName !== recipe) || (coffee && b.coffee !== coffee)) continue;
      const e = m.get(b.waterName) ?? { n: 0, sum: 0 };
      e.n++;
      e.sum += b.rating;
      m.set(b.waterName, e);
    }
    return [...m.entries()].map(([w, e]) => ({ water: w, n: e.n, avg: e.sum / e.n })).sort((a, b) => b.avg - a.avg);
  }, [brews, recipe, coffee]);

  const rebrew = (b: Brew) => {
    // Start that exact brew again: the logged dose / water / grinder / grind setting / steps.
    const plan = planFromBrew(b);
    if (!plan.steps.length) {
      // Older log entries (e.g. imported ones) have no stored steps: use the recipe's,
      // pre-scaled to the logged water (the dialog scales relative to plan.waterG).
      const r = recipes.find((x) => x.id === b.recipeId);
      plan.steps = r ? scaleSteps(r.steps, r.waterG, b.waterG) : [{ label: `Pour to ${b.waterG}g`, targetWaterG: b.waterG, atSec: 0 }];
    }
    setBrewing(plan);
  };
  return (
    <div className="stack">
      <div className="toolbar">
        <SearchInput placeholder="Search notes, grind" label="Search brews" value={q} onChange={setQ} />
        <select className="pill-select" aria-label="Filter by coffee" value={coffee} onChange={(e) => setCoffee(e.target.value)}>
          <option value="">All coffees</option>
          {coffees.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="pill-select" aria-label="Filter by recipe" value={recipe} onChange={(e) => setRecipe(e.target.value)}>
          <option value="">All recipes</option>
          {recipeNames.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {waterNames.length > 0 && (
          <select className="pill-select" aria-label="Filter by water" value={waterF} onChange={(e) => setWaterF(e.target.value)}>
            <option value="">All waters</option>
            {waterNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>
      {!loaded && <p className="muted">Loading…</p>}
      {loaded && brews.length === 0 && <p className="muted">No brews logged yet.</p>}
      {brews.length > 0 && (
        <div className="stats" data-testid="brew-stats">
          <span><strong>{stats.n}</strong> brew{stats.n === 1 ? "" : "s"}</span>
          <span>avg <strong>{stats.avg != null ? stats.avg.toFixed(1) : "—"}</strong>★</span>
          <span><strong>{Math.round(stats.grams)}</strong> g coffee</span>
        </div>
      )}
      {byCoffee.length > 1 && !coffee && (
        <details className="card small">
          <summary>Best-rated coffees{recipe ? ` for ${recipe}` : ""}</summary>
          <ol className="small">{byCoffee.map((c) => <li key={c.coffee}>{c.coffee} — {c.avg.toFixed(1)}★ ({c.n})</li>)}</ol>
        </details>
      )}
      {byWater.length > 1 && !waterF && (
        <details className="card small" data-testid="water-compare">
          <summary>Waters compared{[recipe, coffee].filter(Boolean).length ? ` for ${[recipe, coffee].filter(Boolean).join(" · ")}` : ""}</summary>
          <ol className="small">{byWater.map((w) => <li key={w.water}>{w.water} — {w.avg.toFixed(1)}★ ({w.n})</li>)}</ol>
        </details>
      )}
      <ul className="log">
        {shown.map((b) => {
          const bag = bags.find((x) => x.id === b.inventoryId);
          return (
            <li key={b.id} className="card" data-testid={`brew-${b.id}`}>
              <header>
                <h3>{b.recipeName ?? "Brew"}</h3>
                <span className="muted small">{fmtDate(b.brewedAt)}</span>
              </header>
              <div className="small">
                {b.brewerName ?? "—"} · {b.doseG} g / {b.waterG} g ({fmtRatio(ratioOf(b.doseG, b.waterG))}) · {b.tempC != null ? `${temp.fmt(b.tempC)} · ` : ""}
                <span data-testid="brew-grind">{grindLabel(b, gear)}</span>
                {b.totalTimeSec != null ? ` · ${fmtTime(b.totalTimeSec)}` : ""}
              </div>
              <div className="small" data-testid="brew-coffee">Coffee: {b.coffee ?? "—"}{bag ? " (from Stash)" : ""}</div>
              {b.waterName && <div className="small" data-testid="brew-water">Water: {b.waterName}</div>}
              {b.rating != null && <Stars value={b.rating} />}
              {b.notes && <p className="small">{b.notes}</p>}
              <div className="row wrap">
                <button className="primary" onClick={() => rebrew(b)}>Re-brew</button>
                <button onClick={() => setEditing(b)}>Edit</button>
              </div>
            </li>
          );
        })}
      </ul>
      {brewing && <ScaleDialog plan={brewing} onClose={() => setBrewing(null)} />}
      {editing && <BrewForm brew={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BrewForm({ brew, onClose }: { brew: Brew | null; onClose: () => void }) {
  const { limits, gear, bags, recipes, reload, toast, act } = useData();
  const temp = useTemp();
  const grinders = gear.filter((g) => g.type === "grinder");
  const brewers = gear.filter((g) => g.type === "brewer");
  const [f, setF] = useState({
    recipeId: brew?.recipeId ?? null as number | null,
    recipeName: brew?.recipeName ?? "",
    brewerId: brew?.brewerId ?? null as string | null,
    brewerName: brew?.brewerName ?? null as string | null,
    coffee: brew?.coffee ?? "",
    doseG: brew?.doseG ?? null as number | null,
    waterG: brew?.waterG ?? null as number | null,
    tempC: brew?.tempC ?? null as number | null,
    grinderId: brew?.grinderId ?? null as string | null,
    grinderName: brew?.grinderName ?? null as string | null,
    grindSetting: brew?.grindSetting ?? null as number | null,
    inventoryId: brew?.inventoryId ?? null as number | null,
    rating: brew?.rating ?? null as number | null,
    notes: brew?.notes ?? "",
    totalTimeSec: brew?.totalTimeSec ?? null as number | null,
    waterId: brew?.waterId ?? null as number | null,
    waterName: brew?.waterName ?? null as string | null,
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setError(null);
    const body = { ...f, recipeName: f.recipeName || null, coffee: f.coffee || null, notes: f.notes || null };
    try {
      if (brew) await api.put(`/api/brews/${brew.id}`, body);
      else await api.post("/api/brews", body);
      await reload(["brews", "bags", "water"]);
      toast("Brew saved");
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const del = async () => {
    if (!brew || !confirm("Delete this brew?")) return;
    const ok = await act(async () => {
      await api.del(`/api/brews/${brew.id}`);
      await reload(["brews", "bags", "water"]);
    }, "Brew deleted");
    if (ok) onClose();
  };
  return (
    <FullScreen title={brew ? "Edit brew" : "Log a brew"} onClose={onClose}
      footer={<div className="row">{brew && <button className="danger" onClick={del}>Delete</button>}<button onClick={onClose}>Cancel</button><button className="primary grow" onClick={save}>Save brew</button></div>}>
      <div className="stack form" data-testid="brew-form">
        <div className="grid2">
          <Field label="Recipe" htmlFor="bl-recipe">
            <select id="bl-recipe" value={f.recipeId ?? ""} onChange={(e) => {
              const r = recipes.find((x) => x.id === Number(e.target.value));
              setF((x) => r ? { ...x, recipeId: r.id, recipeName: r.name, brewerId: r.brewerId, brewerName: r.brewerName, doseG: x.doseG ?? r.doseG, waterG: x.waterG ?? r.waterG, tempC: x.tempC ?? r.tempC, grinderId: x.grinderId ?? r.grinderId, grindSetting: x.grindSetting ?? r.grindSetting, waterId: x.waterId ?? r.waterId } : { ...x, recipeId: null });
            }}>
              <option value="">{f.recipeName && !f.recipeId ? f.recipeName : "— none —"}</option>
              {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Brewer" htmlFor="bl-brewer">
            <select id="bl-brewer" value={f.brewerId ?? ""} onChange={(e) => set("brewerId", e.target.value || null)}>
              <option value="">{f.brewerName && !f.brewerId ? f.brewerName : "— none —"}</option>
              {brewers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid2">
          <Field label="From your inventory" htmlFor="bl-bag">
            <select id="bl-bag" value={f.inventoryId ?? ""} onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              const bag = bags.find((b) => b.id === id);
              setF((x) => ({ ...x, inventoryId: id, coffee: bag ? bag.name : x.coffee }));
            }}>
              <option value="">— none —</option>
              {bags.filter((b) => b.status !== "finished" || b.id === f.inventoryId).map((b) => <option key={b.id} value={b.id}>{b.name}{b.roaster ? ` — ${b.roaster}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Coffee" htmlFor="bl-coffee"><input id="bl-coffee" value={f.coffee} onChange={(e) => set("coffee", e.target.value)} /></Field>
        </div>
        <div className="grid3">
          <Field label="Coffee (g)" htmlFor="bl-dose"><NumInput id="bl-dose" value={f.doseG} onChange={(n) => set("doseG", n)} min={limits?.doseG.min} max={limits?.doseG.max} decimals={1} /></Field>
          <WaterInput id="bl-water" label={gear.find((g) => g.id === f.brewerId)?.defaultMethod === "espresso" ? "Yield" : "Water"} grams={f.waterG} onChange={(n) => set("waterG", n)} />
          <Field label={`Temp (${temp.label})`} htmlFor="bl-temp"><TempInput id="bl-temp" value={f.tempC} onChange={(n) => set("tempC", n)} /></Field>
        </div>
        <div className="grid2">
          <Field label="Grinder" htmlFor="bl-grinder">
            <select id="bl-grinder" value={f.grinderId ?? ""} onChange={(e) => set("grinderId", e.target.value || null)}>
              <option value="">{f.grinderName && !f.grinderId ? f.grinderName : "— none —"}</option>
              {grinders.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label={`Grind setting${grinders.find((g) => g.id === f.grinderId)?.units ? ` (${grinders.find((g) => g.id === f.grinderId)!.units})` : ""}`} htmlFor="bl-grind">
            <NumInput id="bl-grind" value={f.grindSetting} onChange={(n) => set("grindSetting", n)} min={0} max={10000} decimals={2} />
          </Field>
        </div>
        <WaterSelect id="bl-waterrec" value={f.waterId} onChange={(id) => setF((x) => ({ ...x, waterId: id, waterName: id == null ? null : x.waterName }))} keptName={f.waterName} />
        <Field label="Total time (s)" htmlFor="bl-time"><NumInput id="bl-time" value={f.totalTimeSec} onChange={(n) => set("totalTimeSec", n)} min={0} max={limits?.totalTimeSec.max} decimals={0} /></Field>
        <Field label="Rating"><Stars value={f.rating} onChange={(n) => set("rating", n)} /></Field>
        <Field label="Notes" htmlFor="bl-notes"><textarea id="bl-notes" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <ErrorBox error={error} />
      </div>
    </FullScreen>
  );
}
