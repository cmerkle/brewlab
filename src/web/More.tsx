import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useData, fmtDate, NumInput, useVocab } from "./ui";
import { METHODS, METHOD_LABELS, DEFAULT_DOSE_NUDGE, rangeFor, fmtGrindNumber, type DoseNudge } from "../shared/grind";
import { RatioCalculator } from "./brew/RatioCalculator";
import { PrefsForm } from "./Setup";
import { AiProvider } from "./AiProvider";
import { NAV_ICONS as I, Icon } from "./icons";

interface Health {
  llm: boolean;
  llmProvider: { provider: string; model: string | null; researchSupported: boolean; problem: string | null };
  ocr: boolean;
  counts: Record<string, number>;
  tz: string | null;
}
interface Backups { dir: string; keep: number; keepDefault: number; custom: boolean; backups: { name: string; bytes: number; createdAt: string }[] }

const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;

const PAGES = [
  { id: "guide", href: "#/brew/guide", label: "Grind guide & converter", icon: I.ruler },
  { id: "gear", href: "#/brew/gear", label: "Gear", icon: I.gear },
  { id: "water", href: "#/brew/water", label: "Water", icon: I.drop },
  { calc: true, label: "Ratio calculator", icon: I.calc },
  { id: "insights", href: "#/brew/insights", label: "Insights", icon: I.chart },
  { href: "#/more/settings", label: "Settings", icon: I.sliders },
] as const;

/**
 * More: the pages that aren't in the main bar (`inMore`, from App: on touch screens Guide, Gear,
 * Water and Insights; on desktop whichever the top bar had no room for), plus the calculator and Settings.
 */
export function More({ inMore }: { inMore: string[] }) {
  const [calc, setCalc] = useState(false);
  return (
    <div className="stack">
      <section className="card" data-testid="more-pages">
        <ul className="link-list">
          {PAGES.filter((x) => !("id" in x) || inMore.includes(x.id)).map((x) => {
            const inner = <><span className="link-text"><span className="link-ico"><Icon d={x.icon} /></span>{x.label}</span> <span className="muted">›</span></>;
            return <li key={x.label}>{"calc" in x ? <button className="link-row" onClick={() => setCalc(true)}>{inner}</button> : <a href={x.href}>{inner}</a>}</li>;
          })}
        </ul>
      </section>
      {calc && <RatioCalculator onClose={() => setCalc(false)} />}
    </div>
  );
}

/** More → Settings: everything that isn't a tool. */
export function Settings() {
  const { act, settings, saveSettings, reloadSetup } = useData();
  const [health, setHealth] = useState<Health | null>(null);
  const load = useCallback(() => {
    api.get<Health>("/api/health").then(setHealth).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const ios = /iphone|ipad/i.test(navigator.userAgent);

  const group = (title: string) => <h2 className="group">{title}</h2>;

  // Four groups instead of one long scroll: brewing, Discover and AI, your data, and the app itself.
  return (
    <div className="stack" data-testid="settings">
      {group("Brewing")}
      <section className="card" data-testid="settings-units">
        <h2>Units and defaults</h2>
        <PrefsForm />
      </section>
      <DoseNudgeSettings />
      <RestSettings />

      {group("Discover and AI")}
      <section className="card" data-testid="settings-discover">
        <div className="pref-row">
          <h2>Discover</h2>
          <div className="seg big" role="group" aria-label="Show Discover">
            {[true, false].map((v) => (
              <button key={String(v)} className={settings.discoverEnabled === v ? "on" : ""} aria-pressed={settings.discoverEnabled === v}
                onClick={() => act(() => saveSettings({ discoverEnabled: v }))}>{v ? "On" : "Off"}</button>
            ))}
          </div>
        </div>
        <p className="muted small">The weekly board of coffees to try. Off hides the Discover tab; nothing is deleted.</p>
      </section>
      <section className="card" data-testid="ai-card">
        <h2>AI provider</h2>
        <p className="muted small">Optional. Reads bag photos and researches the weekly Discover board. Without it, Brewlab uses OCR and you add board candidates yourself.</p>
        <AiProvider />
      </section>

      {group("Your data")}
      <BackupsCard />
      <section className="card" data-testid="settings-setup">
        <h2>Setup</h2>
        <button className="block" onClick={() => act(async () => { await api.post("/api/setup/restart"); await reloadSetup(); })}>
          Run setup again
        </button>
        <p className="muted small">Setup again only adds — your gear, recipes and data stay.</p>
      </section>

      {group("App")}
      {!standalone() && (
        <section className="card">
          <h2>Install the app</h2>
          {ios ? (
            <p className="small">In Safari, tap <strong>Share</strong> → <strong>Add to Home Screen</strong>. Brewlab then opens full-screen with its own icon.</p>
          ) : (
            <p className="small">In Chrome or Edge, use the install icon in the address bar (or menu → <strong>Install Brewlab</strong>). Installing needs the HTTPS address.</p>
          )}
        </section>
      )}
      <About />
      {health && (
        <section className="card" data-testid="status">
          <h2>Status</h2>
          <dl className="facts">
            <div><dt>LLM</dt><dd>{health.llm ? `${health.llmProvider.provider} · ${health.llmProvider.model}` : "off"}</dd></div>
            <div><dt>Weekly research</dt><dd>{health.llmProvider.researchSupported ? "automatic" : "manual"}</dd></div>
            <div><dt>Photo OCR</dt><dd>{health.ocr ? "available" : "unavailable"}</dd></div>
            <div><dt>Time zone</dt><dd>{health.tz ?? "—"}</dd></div>
          </dl>
          {health.llmProvider.problem && <div className="note">{health.llmProvider.problem}</div>}
          <p className="small muted">
            {[
              [health.counts.userRecipes + health.counts.starterRecipes, "recipe"], [health.counts.brews, "brew"], [health.counts.inventory, "bag"],
              [health.counts.editions, "board edition"], [health.counts.tastings, "tasting"], [health.counts.gear, "gear item"],
            ].map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`).join(" · ")}
          </p>
        </section>
      )}
      <ScreenInfo />
    </div>
  );
}

interface AboutInfo {
  version: string;
  repo: string;
  links: { releases: string; bug: string; gear: string; contributing: string };
  update: { enabled: boolean; checkedAt: string | null; latest: string | null; url: string | null; error: string | null; newer: boolean };
}

/** The device line a bug report starts with (shown to the user on GitHub before anything is sent). */
function deviceSummary() {
  const i = measureScreen();
  return `${navigator.userAgent}\nViewport ${i.viewport} · ${i.mode} · ${i.layout} layout`;
}

/** Version, project links (release notes, bug report, gear request) and the optional update check. */
function About() {
  const { settings, saveSettings, act } = useData();
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    api.get<AboutInfo>("/api/about").then(setInfo).catch(() => {});
  }, [settings.updateCheck]);
  const checkNow = async () => {
    setChecking(true);
    await act(async () => setInfo(await api.post<AboutInfo>("/api/about/check")));
    setChecking(false);
  };
  if (!info) return null;
  const u = info.update;
  const bugUrl = `${info.links.bug}&version=${encodeURIComponent(info.version)}&device=${encodeURIComponent(deviceSummary())}`;
  return (
    <section className="card stack" data-testid="about">
      <h2>About</h2>
      <p className="about-version">
        Brewlab <strong data-testid="app-version">{info.version}</strong>{" · "}
        <a href={info.links.releases} target="_blank" rel="noopener noreferrer">What's new</a>
      </p>
      {u.newer && (
        <div className="ok-note small" data-testid="update-available">
          <strong>Brewlab {u.latest} is out.</strong>{" "}
          {u.url && <a href={u.url} target="_blank" rel="noopener noreferrer">Release notes</a>}
          <br />To update, run this on the server (your data stays):
          <code className="cmd">docker compose pull &amp;&amp; docker compose up -d</code>
          or, if you build from source:
          <code className="cmd">git pull &amp;&amp; docker compose up -d --build</code>
        </div>
      )}
      <label className="toggle-row">
        <input type="checkbox" checked={settings.updateCheck} data-testid="update-check"
          onChange={(e) => {
            const on = e.target.checked;
            act(async () => {
              await saveSettings({ updateCheck: on });
              if (on) await checkNow();
            });
          }} />
        <span>Check for updates once a day</span>
      </label>
      <p className="hint">Asks GitHub for the latest release ({info.repo.replace("https://", "")}). Nothing about you or your coffee is sent, but GitHub sees your server's address. Off by default.</p>
      <div className="row wrap">
        <button disabled={checking} onClick={checkNow} data-testid="check-now">{checking ? "Checking…" : "Check now"}</button>
        <span className="small muted" data-testid="update-status" aria-live="polite">
          {u.checkedAt
            ? u.error ? `${u.error} (${fmtDate(u.checkedAt)})`
              : u.latest ? (u.newer ? `${u.latest} available` : `Up to date · checked ${fmtDate(u.checkedAt)}`)
              : `No releases published yet · checked ${fmtDate(u.checkedAt)}`
            : "Not checked yet"}
        </span>
      </div>
      <ul className="link-list">
        <li><a href={bugUrl} target="_blank" rel="noopener noreferrer" data-testid="report-bug">Report a bug <span className="muted">›</span></a></li>
        <li><a href={info.links.gear} target="_blank" rel="noopener noreferrer" data-testid="request-gear">Ask for gear to be added <span className="muted">›</span></a></li>
        <li><a href={info.repo} target="_blank" rel="noopener noreferrer">Source code on GitHub <span className="muted">›</span></a></li>
      </ul>
      <p className="hint">These open GitHub in your browser; a bug report starts with your Brewlab version and device, and nothing is sent until you submit it there. Have gear of your own with a cited grind chart? Use <strong>Suggest to the library</strong> in its gear editor.</p>
    </section>
  );
}

/** Live screen diagnostics — what this device actually reports (sizes, safe areas, mode). */
function measureScreen() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:100dvh;" +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string) => Math.round(parseFloat(v) || 0);
  const lvhProbe = document.createElement("div");
  lvhProbe.style.cssText = "position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:100lvh;";
  document.body.appendChild(lvhProbe);
  const lvh = Math.round(lvhProbe.getBoundingClientRect().height);
  lvhProbe.remove();
  const out = {
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    dvh: Math.round(probe.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)),
    lvh,
    app: Math.round(document.querySelector(".shell")?.getBoundingClientRect().height ?? 0),
    visual: window.visualViewport ? `${Math.round(window.visualViewport.width)}×${Math.round(window.visualViewport.height)}` : "—",
    screen: `${screen.width}×${screen.height}`,
    dpr: window.devicePixelRatio,
    safe: `T ${px(cs.paddingTop)} · R ${px(cs.paddingRight)} · B ${px(cs.paddingBottom)} · L ${px(cs.paddingLeft)}`,
    orientation: window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait",
    mode: window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone ? "home-screen app" : "browser",
    layout: document.documentElement.classList.contains("tabbar") ? "tab bar (touch)" : "top nav (desktop)",
  };
  probe.remove();
  return out;
}

export function ScreenInfo() {
  const [info, setInfo] = useState(measureScreen);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const on = () => setTimeout(() => setInfo(measureScreen()), 300);
    window.addEventListener("resize", on);
    window.visualViewport?.addEventListener("resize", on);
    return () => {
      window.removeEventListener("resize", on);
      window.visualViewport?.removeEventListener("resize", on);
    };
  }, []);
  const text = Object.entries(info).map(([k, v]) => `${k}: ${v}`).join("\n");
  return (
    <section className="card" data-testid="screen-info">
      <h2>Screen</h2>
      <dl className="facts">
        <div><dt>Viewport</dt><dd>{info.viewport}</dd></div>
        <div><dt>100dvh / 100lvh</dt><dd>{info.dvh} / {info.lvh}</dd></div>
        <div><dt>App height</dt><dd>{info.app}</dd></div>
        <div><dt>Visual viewport</dt><dd>{info.visual}</dd></div>
        <div><dt>Screen</dt><dd>{info.screen} @{info.dpr}x</dd></div>
        <div><dt>Safe area</dt><dd>{info.safe}</dd></div>
        <div><dt>Orientation</dt><dd>{info.orientation}</dd></div>
        <div><dt>Mode</dt><dd>{info.mode}</dd></div>
        <div><dt>Layout</dt><dd>{info.layout}</dd></div>
      </dl>
      <div className="row wrap">
        <button onClick={() => setInfo(measureScreen())}>Refresh</button>
        <button onClick={async () => {
          try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
        }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="hint">If the tab bar ever floats above the bottom, tap Refresh, then Copy and send these numbers.</p>
    </section>
  );
}

/** Brew setup's "grind for a different dose" adjustment: on/off, how much, which methods. */
/** How long each roast level rests, and when its peak window ends (days off roast). */
function RestSettings() {
  const { settings, saveSettings, act } = useData();
  const vocab = useVocab();
  const [draft, setDraft] = useState<Record<string, { rest: number | null; peakEnd: number | null }>>({});
  const value = (id: string, k: "rest" | "peakEnd") => {
    const lv = vocab.roastLevels.find((l) => l.id === id)!;
    return draft[id]?.[k] !== undefined ? draft[id][k] : settings.restWindows[id]?.[k] ?? lv[k];
  };
  const edit = (id: string, k: "rest" | "peakEnd", n: number | null) => setDraft((d) => ({ ...d, [id]: { rest: value(id, "rest"), peakEnd: value(id, "peakEnd"), [k]: n } }));
  const bad = vocab.roastLevels.filter((l) => { const r = value(l.id, "rest"), p = value(l.id, "peakEnd"); return r == null || p == null || r >= p; });
  const save = () => {
    const next = { ...settings.restWindows };
    for (const l of vocab.roastLevels) {
      const w = { rest: value(l.id, "rest")!, peakEnd: value(l.id, "peakEnd")! };
      if (w.rest === l.rest && w.peakEnd === l.peakEnd) delete next[l.id]; // same as the default: keep following it
      else next[l.id] = w;
    }
    act(async () => { await saveSettings({ restWindows: next }); setDraft({}); }, "Saved");
  };
  const custom = Object.keys(settings.restWindows).length > 0;
  return (
    <section className="card stack" data-testid="rest-settings">
      <h2>Rest and peak window</h2>
      <p className="muted small">Days off roast, by roast level: beans rest until the first day, then stay at their best until the second. The Stash's freshness notes use these. The starting values are common rules of thumb; lighter roasts usually want longer.</p>
      <table className="rest-table">
        <thead><tr><th>Roast</th><th>Best from day</th><th>Best until day</th></tr></thead>
        <tbody>
          {vocab.roastLevels.map((l) => (
            <tr key={l.id}>
              <td>{l.label}</td>
              <td><NumInput className="short" aria-label={`${l.label}: best from day`} value={value(l.id, "rest")} onChange={(n) => edit(l.id, "rest", n)} min={0} max={365} decimals={0} /></td>
              <td><NumInput className="short" aria-label={`${l.label}: best until day`} value={value(l.id, "peakEnd")} onChange={(n) => edit(l.id, "peakEnd", n)} min={1} max={730} decimals={0} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {bad.length > 0 && <div className="note" role="status">{bad.map((l) => l.label).join(", ")}: the best-until day has to come after the best-from day.</div>}
      <div className="row wrap">
        {Object.keys(draft).length > 0 && <button className="primary" disabled={bad.length > 0} onClick={save}>Save</button>}
        {Object.keys(draft).length > 0 && <button onClick={() => setDraft({})}>Cancel</button>}
        {custom && !Object.keys(draft).length && <button className="link" onClick={() => act(() => saveSettings({ restWindows: {} }), "Back to the starting values")}>Back to the starting values</button>}
      </div>
    </section>
  );
}

function BackupsCard() {
  const { act, reloadSetup } = useData();
  const [b, setB] = useState<Backups | null>(null);
  const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState<number | null>(null);
  const load = useCallback(() => api.get<Backups>("/api/backups").then((x) => { setB(x); setKeep(x.keep); }).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const backupNow = async () => {
    setBusy(true);
    await act(async () => { await api.post("/api/backups"); await load(); }, "Backup created");
    setBusy(false);
  };
  const remove = (name: string) => {
    if (!confirm(`Delete the backup ${name}? This can't be undone.`)) return;
    act(async () => { await api.del(`/api/backups/${encodeURIComponent(name)}`); await load(); }, "Backup deleted");
  };
  // null = back to the default (BACKUP_KEEP)
  const saveKeep = (n: number | null) => {
    if (!b) return;
    const next = n ?? b.keepDefault;
    const lose = Math.max(0, b.backups.length - next);
    if (lose && !confirm(`Keeping ${next} deletes the ${lose} oldest backup${lose === 1 ? "" : "s"} now. Continue?`)) return;
    act(async () => { await api.put("/api/backups/retention", { keep: n }); await load(); await reloadSetup(); }, "Saved");
  };
  const changed = b != null && keep != null && keep !== b.keep;
  return (
    <section className="card" data-testid="backups">
      <h2>Backups</h2>
      <p className="small muted">A snapshot of the database is saved every night at 3 a.m. Photos aren't included — back up the whole data volume for those.</p>
      <div className="row wrap">
        <button className="primary" disabled={busy} onClick={backupNow}>{busy ? "Backing up…" : "Back up now"}</button>
        <a className="button" href="/api/export" download>Export all data (JSON)</a>
      </div>
      {b && (
        <div className="pref-row" data-testid="backup-keep">
          <label htmlFor="backup-keep">Keep the newest</label>
          <div className="row">
            <NumInput id="backup-keep" className="short" value={keep} onChange={setKeep} min={1} max={365} decimals={0} aria-label="Backups to keep" />
            <span className="small">backups</span>
            {changed && keep! >= 1 && keep! <= 365 && <button onClick={() => saveKeep(Math.round(keep!))}>Save</button>}
          </div>
        </div>
      )}
      {b && (
        <p className="small muted">
          Older ones are deleted when a new backup is made, nightly or by hand.
          {b.custom ? <> Default is {b.keepDefault}. <button className="link" onClick={() => saveKeep(null)}>Use the default</button></> : null}
        </p>
      )}
      {b && b.backups.length > 0 ? (
        <ul className="plain small" data-testid="backup-list">
          {b.backups.map((x) => (
            <li key={x.name} className="backup-row">
              <span>
                <a href={`/api/backups/${encodeURIComponent(x.name)}`} download>{x.name}</a>{" "}
                <span className="muted">· {fmtDate(x.createdAt)} · {Math.round(x.bytes / 1024)} KB</span>
              </span>
              <button className="link danger" aria-label={`Delete ${x.name}`} onClick={() => remove(x.name)}>Delete</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">No backups yet.</p>
      )}
    </section>
  );
}

function DoseNudgeSettings() {
  const { settings, saveSettings, act, gear } = useData();
  // Shown at once and saved in order, so quick edits (typing, ticking boxes) never undo each other.
  const [cfg, setCfg] = useState<DoseNudge>(settings.doseNudge);
  const latest = useRef(cfg);
  const saved = JSON.stringify(settings.doseNudge);
  useEffect(() => {
    latest.current = settings.doseNudge;
    setCfg(settings.doseNudge);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (patch: Partial<DoseNudge>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setCfg(next);
    queue.current = queue.current.then(() => act(() => saveSettings({ doseNudge: next })));
  };
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // A worked example on the user's own gear, so the percentage means something.
  // Worked on the user's own gear (first grinder with a range for a ticked category), so the
  // percentage means something.
  const ex = (() => {
    for (const m of cfg.methods) {
      for (const g of gear.filter((x) => x.type === "grinder")) {
        const r = rangeFor(g, m);
        if (r && r.high > r.low) return { g, m, r };
      }
    }
    return null;
  })();
  const FACTORS: [number, string][] = [[0.5, "½×"], [0.75, "¾×"], [1.25, "1¼×"], [1.5, "1½×"], [2, "2×"], [3, "3×"]];
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±");
  return (
    <section className="card stack" data-testid="dose-nudge-settings">
      <h2>Grind for a different dose</h2>
      <p className="muted small">When you brew more or less coffee than the recipe, Brew setup moves the grind: coarser for a bigger dose (a deeper bed drains slower), finer for a smaller one. You can always type your own number.</p>
      <div className="pref-row">
        <span>Adjust the grind</span>
        <div className="seg big" role="group" aria-label="Adjust the grind for the dose">
          {[true, false].map((v) => (
            <button key={String(v)} className={cfg.enabled === v ? "on" : ""} aria-pressed={cfg.enabled === v} onClick={() => save({ enabled: v })}>{v ? "On" : "Off"}</button>
          ))}
        </div>
      </div>
      {cfg.enabled && (
        <>
          <div className="pref-row">
            <label htmlFor="dn-percent">Per doubling of the dose</label>
            <span className="row">
              <NumInput id="dn-percent" className="short" value={cfg.percent} min={0} max={100} decimals={1}
                onChange={(n) => { if (n != null && n >= 0 && n <= 100) save({ percent: n }); }} />
              <span className="muted">% of the range</span>
            </span>
          </div>
          <div className="hint" data-testid="dose-nudge-explain">
            <p>
              Each <strong>doubling</strong> of the dose moves the grind {fmtGrindNumber(cfg.percent)}% of your grinder's
              low–high range for that grind category (set in Gear) coarser; each <strong>halving</strong> moves it the same
              amount finer. It follows the ratio, not the grams: 1½× the dose moves {Math.round(Math.log2(1.5) * 100)}% as far
              as 2× does, while ½× (−50%) moves the full amount finer.
            </p>
            <table className="guide" data-testid="dose-nudge-table">
              <thead>
                <tr><th>Dose vs recipe</th><th>Grind moves (share of range)</th>{ex && <th>{ex.g.name}, {METHOD_LABELS[ex.m]} {fmtGrindNumber(ex.r.low)}–{fmtGrindNumber(ex.r.high)}{ex.g.units ? ` ${ex.g.units}` : ""}</th>}</tr>
              </thead>
              <tbody>
                {FACTORS.map(([f, l]) => {
                  const pct = (cfg.percent * Math.log2(f));
                  const d = ex ? (pct / 100) * (ex.r.high - ex.r.low) : 0;
                  return (
                    <tr key={f}>
                      <td>{l}</td>
                      <td>{sign(pct)}{fmtGrindNumber(Math.abs(Math.round(pct * 10) / 10))}%</td>
                      {ex && <td>{sign(d)}{fmtGrindNumber(Math.abs(Math.round(d * 100) / 100))}{ex.g.units ? ` ${ex.g.units}` : ""}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ex && <p>Brew setup rounds the result to the grinder's step.</p>}
          </div>
          <fieldset className="checks">
            <legend>Applies to</legend>
            {METHODS.map((m) => (
              <label key={m} className="check">
                <input type="checkbox" checked={cfg.methods.includes(m)}
                  onChange={(e) => save({ methods: e.target.checked ? METHODS.filter((x) => x === m || cfg.methods.includes(x)) : cfg.methods.filter((x) => x !== m) })} />
                {METHOD_LABELS[m]}
              </label>
            ))}
          </fieldset>
          {(cfg.percent !== DEFAULT_DOSE_NUDGE.percent || [...cfg.methods].sort().join() !== [...DEFAULT_DOSE_NUDGE.methods].sort().join()) && (
            <button className="link" onClick={() => save({ percent: DEFAULT_DOSE_NUDGE.percent, methods: [...DEFAULT_DOSE_NUDGE.methods] })}>
              Back to the defaults ({DEFAULT_DOSE_NUDGE.percent}%, {DEFAULT_DOSE_NUDGE.methods.map((m) => METHOD_LABELS[m]).join(", ")})
            </button>
          )}
        </>
      )}
    </section>
  );
}
