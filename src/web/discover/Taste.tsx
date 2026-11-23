// Discover → Your taste: what Brewlab has learned from your ratings, the avoid rules,
// suggestions, the optional quiz and your own words. All of it shapes the weekly board.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useData, type Settings, type AvoidRuleDef } from "../ui";

interface Aff { kind: string; name: string; n: number; avg: number; text: string }
interface TasteView {
  rated: number;
  stage: "popular" | "mixed" | "tailored";
  likes: Aff[];
  dislikes: Aff[];
  coffees: { name: string; roaster: string | null; score: number; sources: string[] }[];
  rules: (AvoidRuleDef & { on: boolean; preset: boolean })[];
  presets: AvoidRuleDef[];
  suggestions: { id: string; text: string }[];
  palateNotes: string;
  tasteQuiz: Settings["tasteQuiz"];
  prompt: string;
}

const STAGES = {
  popular: { title: "Popular picks", text: "No ratings yet, so the board starts with widely loved, approachable coffees across a range of styles. Rate bags, brews or tastings and it adapts." },
  mixed: { title: "Learning your taste", text: "A mix of popular picks and ones close to what you've rated well, plus a style you haven't tried, to learn more." },
  tailored: { title: "Tailored to you", text: "Picks follow what you rate well, plus one wildcard." },
};

export const QUIZ: { key: keyof Settings["tasteQuiz"]; q: string; options: string[] }[] = [
  // Covers the families of the SCA coffee taster's flavour wheel (fruity, floral, sweet, nutty/cocoa,
  // spice, roasted, sour/fermented, green/vegetative). Saved answers are plain strings, so options
  // can be added without breaking anyone's earlier picks.
  { key: "loves", q: "Flavours you love", options: [
    "Berries", "Citrus", "Stone fruit", "Tropical fruit", "Apple & pear", "Grape & wine-like", "Dried fruit",
    "Floral", "Tea-like", "Herbal",
    "Chocolate", "Caramel & sweet", "Honey", "Vanilla", "Brown sugar & molasses",
    "Nutty", "Malty & cereal", "Subtle spice", "Funky / fermented", "Boozy / winey",
  ] },
  { key: "dislikes", q: "Flavours you'd rather avoid", options: [
    "Funky / fermented", "Boozy / winey", "Bitter / roasty", "Smoky / burnt", "Very sour", "Earthy",
    "Herbal / grassy", "Spice-forward", "Flavoured coffees", "Heavy body", "Thin / watery",
  ] },
  { key: "processes", q: "Processes you enjoy", options: ["Washed", "Natural", "Honey", "Anaerobic / experimental", "Co-fermented", "Wet-hulled", "Not sure"] },
  { key: "roasts", q: "Roast", options: ["Light", "Medium-light", "Medium", "Medium-dark", "Dark"] },
];

/** The optional quiz — saves on every tap. Also used in first-run setup. */
export function TasteQuiz() {
  const { settings, saveSettings, act } = useData();
  const q = settings.tasteQuiz;
  const toggle = (k: keyof Settings["tasteQuiz"], v: string) => {
    const has = q[k].includes(v);
    return act(() => saveSettings({ tasteQuiz: { ...q, [k]: has ? q[k].filter((x) => x !== v) : [...q[k], v] } }));
  };
  return (
    <div className="stack" data-testid="taste-quiz">
      {QUIZ.map((s) => (
        <div key={s.key}>
          <div className="small"><strong>{s.q}</strong></div>
          <div className="chips" role="group" aria-label={s.q}>
            {s.options.map((o) => {
              const on = q[s.key].includes(o);
              return <button key={o} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggle(s.key, o)}>{o}</button>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Taste() {
  const { saveSettings, act, settings } = useData();
  const [t, setT] = useState<TasteView | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const load = useCallback(() => api.get<TasteView>("/api/discover/taste").then((v) => { setT(v); setNotes((n) => n ?? v.palateNotes); }), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load, settings]);
  if (!t) return <p className="muted">Loading…</p>;
  const stage = STAGES[t.stage];
  const setRule = (id: string, on: boolean) => {
    const next = t.rules.filter((r) => (r.id === id ? on : r.on)).map((r) => r.id);
    return act(() => saveSettings({ avoidRules: next }));
  };
  const defsOf = (rules: AvoidRuleDef[]) => rules.map(({ id, label, keywords }) => ({ id, label, keywords }));
  const saveRule = (rule: AvoidRuleDef, isNew: boolean) =>
    act(async () => {
      const defs = isNew ? [...defsOf(t.rules), rule] : defsOf(t.rules).map((r) => (r.id === rule.id ? rule : r));
      // A rule you just wrote is meant to apply: switch it on.
      await saveSettings({ ruleDefs: defs, avoidRules: isNew ? [...t.rules.filter((r) => r.on).map((r) => r.id), rule.id] : undefined });
    }, isNew ? "Rule added" : "Rule saved");
  const deleteRule = (id: string) =>
    act(() => saveSettings({ ruleDefs: defsOf(t.rules).filter((r) => r.id !== id) }), "Rule removed");
  const missingPresets = t.presets.filter((p) => !t.rules.some((r) => r.id === p.id));
  const answer = (id: string, accept: boolean) =>
    act(async () => {
      await api.post(`/api/discover/suggestions/${id}`, { accept });
      await saveSettings({}); // refresh settings in the app
    }, accept ? "Avoid rule turned on" : undefined);

  return (
    <div className="stack" data-testid="taste">
      <section className="card" data-testid="taste-stage" data-stage={t.stage}>
        <h2>{stage.title}</h2>
        <p className="small">{stage.text}</p>
        <p className="muted small">{t.rated === 0 ? "No rated coffees yet." : `Based on ${t.rated} rated coffee${t.rated === 1 ? "" : "s"}.`} Tailoring starts at 5.</p>
        {t.likes.length > 0 && (
          <>
            <h3>You rate highly</h3>
            <ul className="plain small">{t.likes.map((a) => <li key={a.kind + a.name}>{a.text}</li>)}</ul>
          </>
        )}
        {t.dislikes.length > 0 && (
          <>
            <h3>You rate low</h3>
            <ul className="plain small">{t.dislikes.map((a) => <li key={a.kind + a.name}>{a.text}</li>)}</ul>
          </>
        )}
        <button className="link" onClick={() => setShowPrompt((x) => !x)}>{showPrompt ? "Hide" : "Show"} what the weekly research is told</button>
        {showPrompt && <pre className="prompt" data-testid="taste-prompt">{t.prompt}</pre>}
      </section>

      {t.suggestions.map((s) => (
        <section className="card suggestion" key={s.id} data-testid={`suggestion-${s.id}`}>
          <p className="small">{s.text}</p>
          <div className="row-actions">
            <button className="link" onClick={() => answer(s.id, false)}>No thanks</button>
            <button className="primary" onClick={() => answer(s.id, true)}>Turn it on</button>
          </div>
        </section>
      ))}

      <section className="card" data-testid="avoid-rules">
        <h2>Always leave out</h2>
        <p className="muted small">
          Hard filters: a coffee whose name, process, roast or tasting notes contain any of a rule's words never reaches the board.
          They're yours to edit, and the starter rules are just suggestions, all off until you turn them on. The quiz and your own words below are softer:
          they steer the research but don't block anything. Coffees you've tried or put on the avoid list are always left out.
        </p>
        <ul className="plain rules">
          {t.rules.map((r) => <RuleRow key={r.id} rule={r} onToggle={(on) => setRule(r.id, on)} onSave={(x) => saveRule(x, false)} onDelete={() => deleteRule(r.id)} />)}
        </ul>
        <NewRule taken={t.rules.map((r) => r.id)} onAdd={(x) => saveRule(x, true)} />
        {missingPresets.length > 0 && (
          <button className="link small" onClick={() => act(() => saveSettings({ ruleDefs: [...defsOf(t.rules), ...missingPresets] }), "Starter rules restored")}>
            Restore starter rules you removed ({missingPresets.map((p) => p.label).join(", ")})
          </button>
        )}
      </section>

      <section className="card">
        <h2>Quick quiz</h2>
        <p className="muted small">Optional. Helps the first boards before you've rated much.</p>
        <TasteQuiz />
      </section>

      <section className="card">
        <h2>In your own words</h2>
        <textarea id="palate-notes" aria-label="Your taste in your own words" rows={6} value={notes ?? ""} onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. I like bright, fruity coffees with clarity; not a fan of heavy fermentation." />
        <div className="row-actions">
          <button className="primary" disabled={(notes ?? "") === t.palateNotes} onClick={() => act(() => saveSettings({ palateNotes: notes ?? "" }), "Saved")}>Save</button>
        </div>
      </section>
    </div>
  );
}

const splitWords = (s: string) => [...new Set(s.split(",").map((w) => w.trim()).filter(Boolean))];

/** One rule: switch, its words, and an inline editor. */
function RuleRow({ rule, onToggle, onSave, onDelete }: {
  rule: AvoidRuleDef & { on: boolean };
  onToggle: (on: boolean) => void;
  onSave: (r: AvoidRuleDef) => Promise<unknown>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(rule.label);
  const [words, setWords] = useState(rule.keywords.join(", "));
  if (editing)
    return (
      <li className="rule editing" data-testid={`rule-${rule.id}`}>
        <label className="small" htmlFor={`rl-${rule.id}`}>Name</label>
        <input id={`rl-${rule.id}`} value={label} onChange={(e) => setLabel(e.target.value)} />
        <label className="small" htmlFor={`rw-${rule.id}`}>Words to look for (comma-separated)</label>
        <input id={`rw-${rule.id}`} value={words} onChange={(e) => setWords(e.target.value)} />
        <div className="row-actions">
          <button className="link danger" onClick={() => { if (confirm(`Remove the rule “${rule.label}”?`)) onDelete(); }}>Remove rule</button>
          <button onClick={() => { setLabel(rule.label); setWords(rule.keywords.join(", ")); setEditing(false); }}>Cancel</button>
          <button className="primary" disabled={!label.trim() || !splitWords(words).length}
            onClick={async () => { if (await onSave({ id: rule.id, label: label.trim(), keywords: splitWords(words) })) setEditing(false); }}>Save</button>
        </div>
      </li>
    );
  return (
    <li className="rule" data-testid={`rule-${rule.id}`}>
      <label className="toggle-row">
        <input type="checkbox" checked={rule.on} onChange={(e) => onToggle(e.target.checked)} data-rule={rule.id} />
        <span>
          {rule.label}
          <span className="muted small rule-words"> — {rule.keywords.join(", ")}</span>
        </span>
      </label>
      <button className="link small" aria-label={`Edit rule ${rule.label}`} onClick={() => setEditing(true)}>Edit</button>
    </li>
  );
}

function NewRule({ taken, onAdd }: { taken: string[]; onAdd: (r: AvoidRuleDef) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [words, setWords] = useState("");
  if (!open) return <button className="link" onClick={() => setOpen(true)} data-testid="rule-add">+ Add a rule</button>;
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "rule";
  let id = `my-${base}`, n = 2;
  while (taken.includes(id)) id = `my-${base}-${n++}`;
  return (
    <div className="rule editing" data-testid="rule-new">
      <label className="small" htmlFor="rn-label">Name</label>
      <input id="rn-label" placeholder="e.g. Peaberries" value={label} onChange={(e) => setLabel(e.target.value)} />
      <label className="small" htmlFor="rn-words">Words to look for (comma-separated)</label>
      <input id="rn-words" placeholder="e.g. peaberry, pea berry" value={words} onChange={(e) => setWords(e.target.value)} />
      <div className="row-actions">
        <button onClick={() => { setOpen(false); setLabel(""); setWords(""); }}>Cancel</button>
        <button className="primary" disabled={!label.trim() || !splitWords(words).length}
          onClick={async () => { if (await onAdd({ id, label: label.trim(), keywords: splitWords(words) })) { setOpen(false); setLabel(""); setWords(""); } }}>Add rule</button>
      </div>
    </div>
  );
}
