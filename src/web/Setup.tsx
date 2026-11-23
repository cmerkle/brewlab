// First-run setup: welcome → brewers → grinders → preferences → starter recipes → Discover.
// Every step can be skipped; More → Settings → "Run setup again" brings it back (data is kept).
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { fmtGrind } from "../shared/grind";
import { AiProvider } from "./AiProvider";
import { TasteQuiz } from "./discover/Taste";
import { useData, BackButton, NumInput, SearchInput, Field, useEdgeSwipeBack, useTemp, type Settings } from "./ui";

interface LibGear {
  id: string; name: string; brand: string | null; type: "grinder" | "brewer" | "other"; category: string;
  units: string | null; hasRanges: boolean; methods: string[]; confidence: string | null; owned: boolean;
}
interface Template {
  id: string; name: string; method: string; credit: string | null; brewerName: string | null; grinderName: string | null;
  grindSetting: number | null; grinderId: string | null; doseG: number; waterG: number; tempC: number | null; alreadyAdded: boolean;
}

export const CATEGORY_LABELS: Record<string, string> = {
  "hand-grinder": "Hand grinders", "electric-grinder": "Electric grinders", "cone-dripper": "Cone drippers",
  "flat-bottom-dripper": "Flat-bottom drippers", "hybrid-dripper": "Hybrid / switch drippers", "immersion-dripper": "Immersion drippers",
  "aeropress": "AeroPress", "rapid-brewer": "Rapid brewers", "french-press": "French presses", "moka-pot": "Moka pots",
  "espresso-machine": "Espresso machines", "batch-brewer": "Drip coffee makers", "cezve": "Cezves (Turkish)",
  "cold-brew-maker": "Cold brew makers", "siphon": "Siphons", "other": "Other",
};
const BREWER_CATEGORIES = Object.keys(CATEGORY_LABELS).filter((c) => !c.endsWith("grinder"));

const STEPS = ["Welcome", "Brewers", "Grinders", "Preferences", "Starter recipes", "Discover"] as const;

export function Setup() {
  const { setup, reloadSetup, reload, act } = useData();
  const [step, setStep] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const goto = (n: number) => {
    setStep(n);
    window.scrollTo(0, 0);
    mainRef.current?.scrollTo(0, 0);
  };
  const finish = () =>
    act(async () => {
      await api.post("/api/setup/complete");
      await Promise.all([reloadSetup(), reload()]);
      location.hash = "#/brew/recipes";
    });
  useEdgeSwipeBack(() => step > 0 && goto(step - 1), step > 0);
  const next = () => (step < STEPS.length - 1 ? goto(step + 1) : finish());

  return (
    <div className="shell setup" data-testid="setup" data-step={STEPS[step]}>
      <header className="top">
        <div className="pagebar">
          {step > 0 && <BackButton onClick={() => goto(step - 1)} />}
          <h1>{step === 0 ? "Welcome to Brewlab" : STEPS[step]}</h1>
          <div className="head-actions">
            {step > 0 && <span className="muted small" aria-label={`Step ${step} of ${STEPS.length - 1}`}>{step}/{STEPS.length - 1}</span>}
          </div>
        </div>
      </header>
      <main ref={mainRef}>
        <div className="stack setup-body">
          {step === 0 && <Welcome empty={setup?.empty ?? true} onFresh={next} onDone={finish} />}
          {step === 1 && <GearStep kind="brewer" />}
          {step === 2 && <GearStep kind="grinder" />}
          {step === 3 && <PrefsForm />}
          {step === 4 && <RecipesStep onAdded={next} />}
          {step === 5 && <DiscoverStep />}
          {step > 0 && step !== 4 && (
            <div className="setup-nav">
              <button className="primary block" onClick={next}>{step === STEPS.length - 1 ? "Finish setup" : "Next"}</button>
              {step < STEPS.length - 1 && <button className="link" onClick={next}>Skip this step</button>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------ 0 · Welcome ------------------------------ */

function Welcome({ empty, onFresh, onDone }: { empty: boolean; onFresh: () => void; onDone: () => void }) {
  const { act, reload, reloadSetup } = useData();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const demo = async () => {
    setBusy(true);
    const ok = await act(async () => {
      await api.post("/api/setup/demo");
      await reload();
    }, "Demo data loaded — everything in it is fictional");
    setBusy(false);
    if (ok) onDone();
  };
  const restore = async (f: File) => {
    setBusy(true);
    const ok = await act(async () => {
      let data: unknown;
      try {
        data = JSON.parse(await f.text());
      } catch {
        throw new Error("That file isn't valid JSON — choose a Brewlab export (.json).");
      }
      await api.post("/api/setup/restore", data);
      await Promise.all([reload(), reloadSetup()]);
    }, "Backup restored");
    setBusy(false);
    if (ok) location.hash = "#/brew/recipes";
  };
  if (!empty)
    return (
      <>
        <p>Setting things up again. Nothing you already have is removed — add gear, change preferences or pick more starter recipes.</p>
        <button className="primary block" onClick={onFresh}>Start</button>
        <button className="block" onClick={onDone}>Exit setup</button>
      </>
    );
  return (
    <>
      <p>Brewlab keeps your recipes, grind settings, beans and brews in one place, and converts grind settings between your grinders.</p>
      <p className="muted small">A few quick steps set it up around your gear. Every step can be skipped and changed later.</p>
      <div className="choice-list">
        <button className="choice primary" onClick={onFresh} disabled={busy}>
          <strong>Set up my gear</strong>
          <span>Pick your brewers and grinders and get recipes that fit them.</span>
        </button>
        <button className="choice" onClick={demo} disabled={busy}>
          <strong>Explore with demo data</strong>
          <span>A sample setup with fictional coffees. You can run setup later from More → Settings.</span>
        </button>
        <button className="choice" onClick={() => file.current?.click()} disabled={busy}>
          <strong>Restore a backup</strong>
          <span>A Brewlab export (More → Backups → Export all data).</span>
        </button>
      </div>
      <input ref={file} type="file" accept="application/json,.json" hidden aria-label="Brewlab export file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ""; }} />
    </>
  );
}

/* ------------------------------ 1–2 · Gear ------------------------------ */

function GearStep({ kind }: { kind: "brewer" | "grinder" }) {
  const { gear, reload, act } = useData();
  const [lib, setLib] = useState<LibGear[] | null>(null);
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState(false);
  const load = () => api.get<{ gear: LibGear[] }>("/api/catalog").then((c) => setLib(c.gear));
  useEffect(() => {
    load().catch(() => setLib([]));
  }, []);
  const mineFor = (id: string) => gear.find((g) => g.catalogId === id);
  const toggle = (g: LibGear) => {
    const mine = mineFor(g.id);
    if (mine && !confirm(`Remove ${mine.name} from your gear? Recipes that use it are kept.`)) return;
    return act(async () => {
      if (mine) await api.del(`/api/gear/${encodeURIComponent(mine.id)}`);
      else await api.post("/api/gear/from-catalog", { catalogId: g.id });
      await reload(["gear"]);
      await load();
    });
  };
  const wanted = (g: LibGear) => (kind === "grinder" ? g.type === "grinder" : g.type !== "grinder");
  const needle = q.trim().toLowerCase();
  const shown = (lib ?? []).filter((g) => wanted(g) && (!needle || `${g.name} ${g.brand ?? ""} ${CATEGORY_LABELS[g.category] ?? ""}`.toLowerCase().includes(needle)));
  const groups = Object.keys(CATEGORY_LABELS).map((c) => [c, shown.filter((g) => g.category === c)] as const).filter(([, gs]) => gs.length);
  const yours = gear.filter((g) => (kind === "grinder" ? g.type === "grinder" : g.type !== "grinder"));

  return (
    <>
      <p className="hint">
        {kind === "brewer" ? "What do you brew with? Tap to add." : "Which grinders do you use? Library grinders come with grind ranges, so settings convert between them."}
      </p>
      {yours.length > 0 && (
        <p className="small" data-testid="setup-yours"><strong>Yours:</strong> {yours.map((g) => g.name).join(", ")}</p>
      )}
      <SearchInput placeholder={kind === "brewer" ? "Search brewers…" : "Search grinders…"} label={`Search the ${kind} library`} value={q} onChange={setQ} />
      {!lib && <p className="muted">Loading…</p>}
      {lib && shown.length === 0 && <p className="muted">Nothing in the library matches — add it as your own below.</p>}
      {groups.map(([cat, gs]) => (
        <section key={cat}>
          <h2 className="group">{CATEGORY_LABELS[cat]}</h2>
          <ul className="lib-list">
            {gs.map((g) => {
              const on = Boolean(mineFor(g.id));
              return (
                <li key={g.id} data-lib={g.id}>
                  <div className="lib-main">
                    <strong>{g.name}</strong>
                    {kind === "grinder" && (
                      <span className="muted small">{g.hasRanges ? `Converts for ${g.methods.length} method${g.methods.length === 1 ? "" : "s"}` : "No grind ranges yet"}</span>
                    )}
                  </div>
                  <button className={on ? "small-btn on" : "primary small-btn"} aria-pressed={on} onClick={() => toggle(g)} aria-label={on ? `Remove ${g.name}` : `Add ${g.name}`}>
                    {on ? "✓ Added" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {custom ? (
        kind === "brewer" ? <CustomBrewer onDone={() => setCustom(false)} /> : <CustomGrinder onDone={() => setCustom(false)} />
      ) : (
        <button className="block" onClick={() => setCustom(true)}>{kind === "brewer" ? "Not listed? Add your own brewer" : "Not listed? Add your own grinder"}</button>
      )}
    </>
  );
}

function CustomBrewer({ onDone }: { onDone: () => void }) {
  const { reload, act } = useData();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("cone-dripper");
  const save = () =>
    act(async () => {
      await api.post("/api/gear", { name: name.trim(), type: category === "other" ? "other" : "brewer", category });
      await reload(["gear"]);
      onDone();
    }, `Added ${name.trim()}`);
  return (
    <section className="card stack" data-testid="custom-brewer">
      <h2>Your own brewer</h2>
      <Field label="Name" htmlFor="cb-name"><input id="cb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kalita Wave 185" /></Field>
      <Field label="Kind" htmlFor="cb-cat" hint="Used to suggest recipes that fit it.">
        <select id="cb-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {BREWER_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      </Field>
      <div className="row-actions">
        <button className="link" onClick={onDone}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={save}>Add brewer</button>
      </div>
    </section>
  );
}

const UNIT_CHOICES = [
  { value: "clicks", label: "Clicks", step: 1 },
  { value: "rotations", label: "Rotations", step: 0.1 },
  { value: "", label: "Numbered dial", step: 0.5 },
];

/** Custom grinder + calibration helper: one familiar setting proposes a pour-over range. */
function CustomGrinder({ onDone }: { onDone: () => void }) {
  const { reload, act } = useData();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("hand-grinder");
  const [units, setUnits] = useState("clicks");
  const [v60, setV60] = useState<number | null>(null);
  const [low, setLow] = useState<number | null>(null);
  const [high, setHigh] = useState<number | null>(null);
  const step = UNIT_CHOICES.find((u) => u.value === units)!.step;
  const round = (n: number) => Math.round(Math.round(n / step) * step * 1000) / 1000;
  // ±10% around the setting they use, at least one step either side — a starting point they adjust.
  const propose = (v: number | null) => {
    setV60(v);
    if (v == null || v <= 0) return;
    const d = Math.max(step, round(v * 0.1));
    setLow(round(v - d));
    setHigh(round(v + d));
  };
  const valid = low != null && high != null && low <= high;
  const save = () =>
    act(async () => {
      await api.post("/api/gear", {
        name: name.trim(), type: "grinder", category, units,
        grindRanges: valid ? { step, methods: { pourover: { low, high } } } : null,
      });
      await reload(["gear"]);
      onDone();
    }, `Added ${name.trim()}`);
  return (
    <section className="card stack" data-testid="custom-grinder">
      <h2>Your own grinder</h2>
      <Field label="Name" htmlFor="cg-name"><input id="cg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Comandante C40" /></Field>
      <div className="grid2">
        <Field label="Kind" htmlFor="cg-cat">
          <select id="cg-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="hand-grinder">Hand grinder</option>
            <option value="electric-grinder">Electric grinder</option>
          </select>
        </Field>
        <Field label="Settings are in" htmlFor="cg-units">
          <select id="cg-units" value={units} onChange={(e) => { setUnits(e.target.value); setLow(null); setHigh(null); setV60(null); }}>
            {UNIT_CHOICES.map((u) => <option key={u.label} value={u.value}>{u.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="What setting do you use for a V60 / pour-over?" htmlFor="cg-v60" hint="Optional — skip it and the grinder still works; you just type settings yourself.">
        <NumInput id="cg-v60" value={v60} onChange={propose} decimals={2} />
      </Field>
      {(low != null || high != null) && (
        <div className="stack" data-testid="calibration">
          <p className="small">Proposed pour-over range — adjust it to match your dial. Conversions use where a setting sits inside this range.</p>
          <div className="grid2">
            <Field label="Finest pour-over" htmlFor="cg-low"><NumInput id="cg-low" value={low} onChange={setLow} decimals={2} /></Field>
            <Field label="Coarsest pour-over" htmlFor="cg-high"><NumInput id="cg-high" value={high} onChange={setHigh} decimals={2} /></Field>
          </div>
          {!valid && <p className="error small">The finest setting must be at or below the coarsest.</p>}
          <p className="muted small">Other methods (espresso, French press…) can be added later under Gear, if you know them.</p>
        </div>
      )}
      <div className="row-actions">
        <button className="link" onClick={onDone}>Cancel</button>
        <button className="primary" disabled={!name.trim() || (low != null && !valid)} onClick={save}>Add grinder</button>
      </div>
    </section>
  );
}

/* ------------------------------ 3 · Preferences (also More → Settings) ------------------------------ */

export function PrefsForm() {
  const { settings, saveSettings, act } = useData();
  const set = (patch: Partial<Settings>) => act(() => saveSettings(patch));
  const Seg = <T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: { v: T; l: string }[]; onPick: (v: T) => void }) => (
    <div className="pref-row">
      <span>{label}</span>
      <div className="seg big" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" className={value === o.v ? "on" : ""} aria-pressed={value === o.v} onClick={() => onPick(o.v)}>{o.l}</button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="stack" data-testid="prefs">
      <Seg label="Water" value={settings.waterUnit} options={[{ v: "g", l: "grams" }, { v: "oz", l: "ounces" }]} onPick={(v) => set({ waterUnit: v })} />
      <Seg label="Temperature" value={settings.tempUnit} options={[{ v: "C", l: "°C" }, { v: "F", l: "°F" }]} onPick={(v) => set({ tempUnit: v })} />
      <Seg label="Default ratio" value={settings.defaultRatio} options={[13, 14, 15, 16, 17].map((r) => ({ v: r, l: `1:${r}` }))} onPick={(v) => set({ defaultRatio: v })} />
      <p className="muted small">The brew timer always reads grams. Each device can still flip g/oz on any water field.</p>
    </div>
  );
}

/* ------------------------------ 4 · Starter recipes ------------------------------ */

function RecipesStep({ onAdded }: { onAdded: () => void }) {
  const { reload, act, gear } = useData();
  const temp = useTemp();
  const [list, setList] = useState<Template[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.get<Template[]>("/api/setup/templates").then((l) => {
      setList(l);
      setPicked(new Set(l.filter((t) => !t.alreadyAdded).map((t) => t.id)));
    }).catch(() => setList([]));
  }, []);
  const n = picked.size;
  const add = async () => {
    if (!n) return onAdded();
    const ok = await act(async () => {
      const r = await api.post<{ created: unknown[] }>("/api/recipes/from-templates", { ids: [...picked] });
      await reload(["recipes"]);
      return r;
    }, `Added ${n} recipe${n === 1 ? "" : "s"}`);
    if (ok) onAdded();
  };
  const groups = useMemo(() => {
    const m = new Map<string, Template[]>();
    for (const t of list ?? []) m.set(t.brewerName ?? "", [...(m.get(t.brewerName ?? "") ?? []), t]);
    return [...m.entries()];
  }, [list]);
  return (
    <>
      <p className="hint">Recipes your gear can brew, with grind settings already in your grinder's units. Untick any you don't want.</p>
      {!list && <p className="muted">Loading…</p>}
      {list && list.length === 0 && <p className="muted">No starter recipes fit your gear yet — add a brewer (Back), or skip and write your own.</p>}
      {groups.map(([brewer, ts]) => (
        <section key={brewer}>
          <h2 className="group">{brewer}</h2>
          <ul className="lib-list">
            {ts.map((t) => (
              <li key={t.id} data-template={t.id}>
                <label className="tpl">
                  <input type="checkbox" checked={picked.has(t.id)} disabled={t.alreadyAdded}
                    onChange={(e) => setPicked((s) => { const x = new Set(s); e.target.checked ? x.add(t.id) : x.delete(t.id); return x; })} />
                  <span className="lib-main">
                    <strong>{t.name}</strong>
                    <span className="muted small" data-testid="tpl-detail">
                      {t.doseG} g : {t.waterG} g{t.tempC != null ? ` · ${temp.fmt(t.tempC)}` : ""} · {t.grinderName ? `${t.grinderName} ${t.grindSetting != null ? fmtGrind(t.grindSetting, gear.find((g) => g.id === t.grinderId)) : "— set the grind yourself"}` : "no grinder"}
                      {t.alreadyAdded ? " · already in your recipes" : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="setup-nav">
        <button className="primary block" onClick={add}>{n ? `Add ${n} recipe${n === 1 ? "" : "s"}` : "Next"}</button>
        {n > 0 && <button className="link" onClick={onAdded}>Skip this step</button>}
      </div>
    </>
  );
}

/* ------------------------------ 5 · Discover ------------------------------ */

function DiscoverStep() {
  const { settings, saveSettings, act } = useData();
  const on = settings.discoverEnabled;
  return (
    <>
      <p>Discover is a weekly board of coffees to try, filtered against what you've tried and what you avoid. It's optional.</p>
      <div className="pref-row">
        <span>Show Discover</span>
        <div className="seg big" role="group" aria-label="Show Discover">
          {[true, false].map((v) => (
            <button key={String(v)} className={on === v ? "on" : ""} aria-pressed={on === v} onClick={() => act(() => saveSettings({ discoverEnabled: v }))}>{v ? "On" : "Off"}</button>
          ))}
        </div>
      </div>
      {on && (
        <>
          <section className="card">
            <h2>Your taste (optional)</h2>
            <p className="muted small">With no ratings yet, the first boards are popular, approachable coffees. A few taps here point them your way; rating what you drink does the rest.</p>
            <TasteQuiz />
          </section>
          <section className="card">
            <h2>AI provider (optional)</h2>
            <p className="muted small">Lets Brewlab research the weekly board and read bag photos. Without one, you add board candidates yourself and Brewlab filters and ranks them.</p>
            <AiProvider />
          </section>
        </>
      )}
    </>
  );
}

