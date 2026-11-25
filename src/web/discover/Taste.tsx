// Discover → Your taste: what Brewlab has learned from your ratings, suggestions, and your
// preferences as tags — five sections (roasters, processes, roast level, origins, tasting notes),
// each with Preferred / Rather avoid / Do not include. Every tag can be switched on or off and
// removed; built-in ones start off. Plus your own words. All of it shapes the weekly board.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useData, useVocab, TagTextInput } from "../ui";
import { PREF_SECTIONS, PREF_LISTS, SECTION_LABELS, LIST_LABELS, newTag, type Prefs, type PrefSection, type PrefList, type PrefTag } from "../../shared/prefs";

interface Aff { kind: string; name: string; n: number; avg: number; text: string }
interface TasteView {
  rated: number;
  stage: "popular" | "mixed" | "tailored";
  likes: Aff[];
  dislikes: Aff[];
  coffees: { name: string; roaster: string | null; score: number; sources: string[] }[];
  suggestions: { id: string; text: string }[];
  defaults: Prefs;
  palateNotes: string;
  prompt: string;
}

const STAGES = {
  popular: { title: "Popular picks", text: "No ratings yet, so the board starts with widely loved, approachable coffees across a range of styles. Rate bags, brews or tastings and it adapts." },
  mixed: { title: "Learning your taste", text: "A mix of popular picks and ones close to what you've rated well, plus a style you haven't tried, to learn more." },
  tailored: { title: "Tailored to you", text: "Picks follow what you rate well, plus one wildcard." },
};

const LIST_HINTS: Record<PrefList, string> = {
  prefer: "Favoured in the weekly research and the ranking.",
  avoid: "Steered away from, but not blocked.",
  exclude: "Left out of the board entirely.",
};

let defaultsCache: Prefs | null = null;

/** Every section back to the built-in tags, all off — after asking. */
export function ResetPrefs() {
  const { act, saveSettings } = useData();
  return (
    <button type="button" data-testid="reset-prefs" onClick={() => {
      if (!confirm("Reset your Discover preferences? Every section goes back to the built-in tags, all switched off, and your own tags are removed. Your ratings and your own words stay.")) return;
      act(async () => { await api.post("/api/discover/prefs/reset"); await saveSettings({}); }, "Preferences reset");
    }}>Reset preferences</button>
  );
}

/**
 * The tag sections. Changes show at once and save in order, so quick taps never undo each other.
 * Also used in first-run setup (with fewer sections).
 */
export function PrefsEditor({ sections = PREF_SECTIONS, defaults }: { sections?: readonly PrefSection[]; defaults?: Prefs | null }) {
  const { settings, saveSettings, act, bags } = useData();
  const vocab = useVocab();
  const [p, setP] = useState<Prefs>(settings.prefs);
  const latest = useRef(p);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saved = JSON.stringify(settings.prefs);
  useEffect(() => {
    latest.current = settings.prefs;
    setP(settings.prefs);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const [defs, setDefs] = useState<Prefs | null>(defaults ?? defaultsCache);
  useEffect(() => {
    if (defaults) { defaultsCache = defaults; setDefs(defaults); return; }
    if (!defaultsCache) api.get<TasteView>("/api/discover/taste").then((v) => { defaultsCache = v.defaults; setDefs(v.defaults); }).catch(() => {});
  }, [defaults]);

  const update = (sec: PrefSection, list: PrefList, f: (l: PrefTag[]) => PrefTag[]) => {
    const next: Prefs = { ...latest.current, [sec]: { ...latest.current[sec], [list]: f(latest.current[sec][list]) } };
    latest.current = next;
    setP(next);
    queue.current = queue.current.then(() => act(() => saveSettings({ prefs: next })));
  };
  const suggestions: Record<PrefSection, string[]> = {
    roasters: [...new Set(bags.map((b) => b.roaster).filter(Boolean) as string[])].sort(),
    processes: vocab.processes,
    roasts: vocab.roastLevels.map((l) => l.label),
    origins: vocab.origins,
    notes: vocab.tastingNotes,
  };

  return (
    <>
      {sections.map((sec) => {
        const missing = defs ? PREF_LISTS.flatMap((l) => defs[sec][l].filter((d) => !p[sec][l].some((t) => t.id === d.id)).map((d) => ({ l, d }))) : [];
        return (
          <section key={sec} className="card stack pref-section" data-testid={`prefs-${sec}`}>
            <h2>{SECTION_LABELS[sec]}</h2>
            <div className="pref-lists">
            {PREF_LISTS.map((list) => (
              <TagList key={list} id={`pref-${sec}-${list}`} label={LIST_LABELS[list]} hint={LIST_HINTS[list]} tags={p[sec][list]} suggestions={suggestions[sec]}
                onAdd={(label) => update(sec, list, (l) => {
                  const same = l.find((t) => t.label.toLowerCase() === label.toLowerCase());
                  return same ? l.map((t) => (t === same ? { ...t, on: true } : t)) : [...l, newTag(label, l)];
                })}
                onToggle={(id) => update(sec, list, (l) => l.map((t) => (t.id === id ? { ...t, on: !t.on } : t)))}
                onRemove={(id) => update(sec, list, (l) => l.filter((t) => t.id !== id))} />
            ))}
            </div>
            {missing.length > 0 && (
              <button type="button" className="link small" onClick={() => {
                for (const l of PREF_LISTS) {
                  const add = missing.filter((m) => m.l === l).map((m) => m.d);
                  if (add.length) update(sec, l, (cur) => [...cur, ...add]);
                }
              }}>Restore {missing.length} built-in tag{missing.length === 1 ? "" : "s"} you removed</button>
            )}
          </section>
        );
      })}
    </>
  );
}

/** One list: an input to add tags, then the tags. Tap a tag to switch it on or off; × removes it. */
function TagList({ id, label, hint, tags, suggestions, onAdd, onToggle, onRemove }: {
  id: string; label: string; hint: string; tags: PrefTag[]; suggestions: string[];
  onAdd: (label: string) => void; onToggle: (id: string) => void; onRemove: (id: string) => void;
}) {
  const add = (raw: string) => {
    for (const t of raw.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) onAdd(t.slice(0, 80));
  };
  return (
    <div className="pref-list" data-testid={id}>
      <label htmlFor={id}>{label}</label>
      <TagTextInput id={id} describedBy={`${id}-hint`} placeholder="Add a tag, then Enter" suggestions={suggestions} taken={tags.map((t) => t.label)} onAdd={add} />
      <div className="hint" id={`${id}-hint`}>{hint}</div>
      {tags.length > 0 && (
        <ul className="ptags" aria-label={label}>
          {tags.map((t) => (
            <li key={t.id} className={`ptag ${t.on ? "on" : ""}`}>
              <button type="button" className="ptag-toggle" aria-pressed={t.on} title={t.words?.length ? `Matches: ${t.words.join(", ")}` : undefined} onClick={() => onToggle(t.id)}>{t.label}</button>
              <button type="button" className="ptag-x" aria-label={`Remove ${t.label}`} onClick={() => onRemove(t.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
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
  const answer = (id: string, accept: boolean) =>
    act(async () => {
      await api.post(`/api/discover/suggestions/${id}`, { accept });
      await saveSettings({}); // refresh settings in the app
    }, accept ? "Switched on under Do not include" : undefined);

  return (
    <div className="stack" data-testid="taste">
      <div className="row-actions"><ResetPrefs /></div>
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

      <p className="muted small">
        Tap a tag to switch it on or off; × removes it. Built-in tags start off. <strong>Preferred</strong> and <strong>Rather avoid</strong> steer the
        weekly research and the ranking; <strong>Do not include</strong> leaves a coffee out. Coffees you've tried or put on the avoid list are always left out.
      </p>
      <PrefsEditor defaults={t.defaults} />

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
