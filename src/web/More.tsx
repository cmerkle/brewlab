import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useData, fmtDate, NumInput } from "./ui";
import { METHODS, METHOD_LABELS, DEFAULT_DOSE_NUDGE, rangeFor, fmtGrindNumber, type DoseNudge } from "../shared/grind";
import { RatioCalculator } from "./brew/RatioCalculator";
import { PrefsForm } from "./Setup";
import { AiProvider } from "./AiProvider";

interface Health {
  llm: boolean;
  llmProvider: { provider: string; model: string | null; researchSupported: boolean; problem: string | null };
  ocr: boolean;
  counts: Record<string, number>;
  tz: string | null;
}
interface Backups { dir: string; keep: number; backups: { name: string; bytes: number; createdAt: string }[] }

const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;

export function More() {
  const { act, settings, saveSettings, reloadSetup } = useData();
  const [calc, setCalc] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [backups, setBackups] = useState<Backups | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get<Health>("/api/health").then(setHealth).catch(() => {});
    api.get<Backups>("/api/backups").then(setBackups).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const backupNow = async () => {
    setBusy(true);
    await act(async () => {
      await api.post("/api/backups");
      load();
    }, "Backup created");
    setBusy(false);
  };
  const ios = /iphone|ipad/i.test(navigator.userAgent);

  return (
    <div className="stack">
      <section className="card">
        <h2>Tools</h2>
        <ul className="link-list">
          <li><a href="#/brew/guide">Grind guide &amp; converter <span className="muted">›</span></a></li>
          <li><a href="#/brew/gear">Gear <span className="muted">›</span></a></li>
          <li><button className="link-row" onClick={() => setCalc(true)}>Ratio calculator <span className="muted">›</span></button></li>
        </ul>
      </section>

      <section className="card" data-testid="settings">
        <h2>Settings</h2>
        <PrefsForm />
        <div className="pref-row">
          <span>Discover</span>
          <div className="seg big" role="group" aria-label="Show Discover">
            {[true, false].map((v) => (
              <button key={String(v)} className={settings.discoverEnabled === v ? "on" : ""} aria-pressed={settings.discoverEnabled === v}
                onClick={() => act(() => saveSettings({ discoverEnabled: v }))}>{v ? "On" : "Off"}</button>
            ))}
          </div>
        </div>
        <button className="block" onClick={() => act(async () => { await api.post("/api/setup/restart"); await reloadSetup(); })}>
          Run setup again
        </button>
        <p className="muted small">Setup again only adds — your gear, recipes and data stay.</p>
      </section>

      <DoseNudgeSettings />

      <section className="card" data-testid="ai-card">
        <h2>AI provider</h2>
        <p className="muted small">Optional. Reads bag photos and researches the weekly Discover board. Without it, Brewlab uses OCR and you add board candidates yourself.</p>
        <AiProvider />
      </section>

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

      <section className="card" data-testid="backups">
        <h2>Backups</h2>
        <p className="small muted">A snapshot of the database is saved every night at 3 a.m. (the last {backups?.keep ?? 14} are kept). Photos aren't included — back up the whole data volume for those.</p>
        <div className="row wrap">
          <button className="primary" disabled={busy} onClick={backupNow}>{busy ? "Backing up…" : "Back up now"}</button>
          <a className="button" href="/api/export" download>Export all data (JSON)</a>
        </div>
        {backups && backups.backups.length > 0 ? (
          <ul className="plain small">
            {backups.backups.map((b) => (
              <li key={b.name}>
                <a href={`/api/backups/${encodeURIComponent(b.name)}`} download>{b.name}</a>{" "}
                <span className="muted">· {fmtDate(b.createdAt)} · {Math.round(b.bytes / 1024)} KB</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No backups yet.</p>
        )}
      </section>

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
      {calc && <RatioCalculator onClose={() => setCalc(false)} />}
    </div>
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
  const ex = (() => {
    for (const m of cfg.methods) {
      for (const g of gear.filter((x) => x.type === "grinder")) {
        const r = rangeFor(g, m);
        if (r && r.high > r.low) {
          const d = (cfg.percent / 100) * (r.high - r.low);
          return `e.g. ${g.name}, ${METHOD_LABELS[m]} ${fmtGrindNumber(r.low)}–${fmtGrindNumber(r.high)}${g.units ? ` ${g.units}` : ""}: twice the dose → ${fmtGrindNumber(Math.round(d * 100) / 100)} coarser, half → that much finer.`;
        }
      }
    }
    return null;
  })();
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
          <p className="hint">The range is your grinder's low–high for that grind category (Gear). {ex}</p>
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
