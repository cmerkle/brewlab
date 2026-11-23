// Discover → Your taste: what Brewlab has learned from your ratings, the avoid rules,
// suggestions, the optional quiz and your own words. All of it shapes the weekly board.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useData, type Settings } from "../ui";

interface Aff { kind: string; name: string; n: number; avg: number; text: string }
interface TasteView {
  rated: number;
  stage: "popular" | "mixed" | "tailored";
  likes: Aff[];
  dislikes: Aff[];
  coffees: { name: string; roaster: string | null; score: number; sources: string[] }[];
  rules: { id: string; label: string; on: boolean }[];
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
  { key: "loves", q: "Flavours you love", options: ["Berries", "Citrus", "Stone fruit", "Tropical fruit", "Floral", "Tea-like", "Chocolate", "Caramel & sweet", "Nutty", "Subtle spice"] },
  { key: "dislikes", q: "Flavours you'd rather avoid", options: ["Funky / fermented", "Boozy / winey", "Bitter / roasty", "Very sour", "Earthy", "Flavoured coffees"] },
  { key: "processes", q: "Processes you enjoy", options: ["Washed", "Natural", "Honey", "Anaerobic / experimental", "Not sure"] },
  { key: "roasts", q: "Roast", options: ["Light", "Medium", "Dark"] },
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
    const next = t.rules.filter((r) => (r.id === id ? on : r.on)).map((r) => r.id) as Settings["avoidRules"];
    return act(() => saveSettings({ avoidRules: next }));
  };
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
        <p className="muted small">Candidates matching these never reach the board. Coffees you've tried or put on the avoid list are always left out.</p>
        {t.rules.map((r) => (
          <label key={r.id} className="toggle-row">
            <input type="checkbox" checked={r.on} onChange={(e) => setRule(r.id, e.target.checked)} data-rule={r.id} />
            <span>{r.label}</span>
          </label>
        ))}
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
