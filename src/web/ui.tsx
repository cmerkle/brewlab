import { DEFAULT_DOSE_NUDGE, type DoseNudge } from "../shared/grind";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Bag, type Brew, type Gear, type Limits, type Recipe } from "./api";
import { G_PER_OZ } from "../shared/brew";

/* ------------------------------ App data ------------------------------ */

/* ------------------------------ Preferences (per device) ------------------------------ */

export function getPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`brewlab.${key}`);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function setPref(key: string, value: unknown) {
  try {
    localStorage.setItem(`brewlab.${key}`, JSON.stringify(value));
  } catch {
    /* private mode / storage blocked — preference just isn't remembered */
  }
}
/** useState that persists to localStorage. */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => getPref(key, fallback));
  return [v, (n: T) => { setV(n); setPref(key, n); }];
}

/** An "always leave out" rule for Discover: any of its words in a coffee's details → left out. */
export interface AvoidRuleDef { id: string; label: string; keywords: string[] }

export interface Settings {
  tempUnit: "C" | "F"; waterUnit: "g" | "oz"; defaultRatio: number; discoverEnabled: boolean;
  ruleDefs: AvoidRuleDef[]; avoidRules: string[]; palateNotes: string;
  tasteQuiz: { loves: string[]; dislikes: string[]; processes: string[]; roasts: string[] };
  dismissedSuggestions: string[];
  doseNudge: DoseNudge;
}
export interface SetupState { onboarded: boolean; empty: boolean; settings: Settings }

interface Data {
  loaded: boolean;
  /** First-run state + preferences (null until loaded). */
  setup: SetupState | null;
  settings: Settings;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  reloadSetup: () => Promise<SetupState>;
  limits: Limits | null;
  gear: Gear[];
  recipes: Recipe[];
  brews: Brew[];
  bags: Bag[];
  reload: (what?: ("gear" | "recipes" | "brews" | "bags")[]) => Promise<void>;
  toast: (msg: string, kind?: "ok" | "err") => void;
  /** Run an action, toasting `ok` on success and the error message on failure. */
  act: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
}
const Ctx = createContext<Data | null>(null);
export const DEFAULT_SETTINGS: Settings = {
  tempUnit: "C", waterUnit: "g", defaultRatio: 16, discoverEnabled: true,
  ruleDefs: [], avoidRules: [], palateNotes: "", tasteQuiz: { loves: [], dislikes: [], processes: [], roasts: [] }, dismissedSuggestions: [],
  doseNudge: DEFAULT_DOSE_NUDGE,
};
export const useData = () => useContext(Ctx)!;

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [gear, setGear] = useState<Gear[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [brews, setBrews] = useState<Brew[]>([]);
  const [bags, setBags] = useState<Bag[]>([]);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const reloadSetup = useCallback(async () => {
    const s = await api.get<SetupState>("/api/setup");
    setSetup(s);
    // The instance's water unit is the starting point; each device can still flip the toggle.
    if (getPref<string | null>("waterUnit", null) == null) setPref("waterUnit", s.settings.waterUnit);
    return s;
  }, []);
  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const settings = await api.put<Settings>("/api/settings", patch);
    if (patch.waterUnit) setPref("waterUnit", patch.waterUnit);
    setSetup((s) => (s ? { ...s, settings } : s));
  }, []);

  const reload = useCallback(async (what: ("gear" | "recipes" | "brews" | "bags")[] = ["gear", "recipes", "brews", "bags"]) => {
    await Promise.all([
      what.includes("gear") && api.get<Gear[]>("/api/gear").then(setGear),
      what.includes("recipes") && api.get<Recipe[]>("/api/recipes").then(setRecipes),
      what.includes("brews") && api.get<Brew[]>("/api/brews").then(setBrews),
      what.includes("bags") && api.get<Bag[]>("/api/inventory").then(setBags),
    ]);
  }, []);
  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const act = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      return true;
    } catch (e: any) {
      toast(e?.message || "Something went wrong", "err");
      return false;
    }
  }, [toast]);
  useEffect(() => {
    api.get<{ limits: Limits }>("/api/schema").then((s) => setLimits(s.limits)).catch(() => {});
    reloadSetup().catch(() => setSetup({ onboarded: true, empty: false, settings: DEFAULT_SETTINGS }));
    reload().then(() => setLoaded(true), (e) => {
      setLoaded(true);
      toast(`Couldn't load your data: ${e.message}`, "err");
    });
    // Safety net: no failed request should ever be silent.
    const onRej = (ev: PromiseRejectionEvent) => {
      const m = ev.reason?.message;
      if (m) toast(m, "err");
    };
    window.addEventListener("unhandledrejection", onRej);
    return () => window.removeEventListener("unhandledrejection", onRej);
  }, [reload, reloadSetup, toast]);

  return (
    <Ctx.Provider value={{ loaded, setup, settings: setup?.settings ?? DEFAULT_SETTINGS, saveSettings, reloadSetup, limits, gear, recipes, brews, bags, reload, toast, act }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/* ------------------------------ Inputs ------------------------------ */

const fmtNum = (n: number | null | undefined, maxDecimals = 2) =>
  n == null || !Number.isFinite(n) ? "" : String(Math.round(n * 10 ** maxDecimals) / 10 ** maxDecimals);

/**
 * Numeric input that is fully clearable: while focused it keeps the in-progress
 * text and never snaps the old number back. Empty → null.
 */
export function NumInput(props: {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  min?: number;
  max?: number;
  decimals?: number;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const { value, onChange, decimals = 2 } = props;
  const [text, setText] = useState(fmtNum(value, decimals));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmtNum(value, decimals));
  }, [value, decimals]);
  const outOfRange = (() => {
    const n = parseFloat(text);
    if (text.trim() === "" || Number.isNaN(n)) return false;
    return (props.min != null && n < props.min) || (props.max != null && n > props.max);
  })();
  return (
    <input
      id={props.id}
      className={`num ${outOfRange ? "invalid" : ""} ${props.className ?? ""}`}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={props["aria-label"]}
      aria-invalid={outOfRange || undefined}
      placeholder={props.placeholder}
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(fmtNum(value, decimals));
      }}
      onChange={(e) => {
        const t = e.target.value.replace(",", ".");
        if (!/^-?\d*\.?\d*$/.test(t)) return;
        setText(t);
        if (t.trim() === "" || t === "." || t === "-") onChange(null);
        else {
          const n = parseFloat(t);
          if (!Number.isNaN(n)) onChange(n);
        }
      }}
    />
  );
}

export type WaterUnit = "g" | "oz";

/** Water field with a g / oz toggle above it. Value is always grams. */
export function WaterInput({
  grams, onChange, id, label = "Water",
}: {
  grams: number | null;
  onChange: (g: number | null) => void;
  id?: string;
  /** "Yield" for espresso. */
  label?: string;
}) {
  const { limits } = useData();
  // g / oz choice is remembered on this device and shared by every water field.
  const [unit, onUnit] = usePref<WaterUnit>("waterUnit", "g");
  const lim = limits?.waterG;
  return (
    <div className="field">
      <div className="label-row">
        <label htmlFor={id}>{label}</label>
        <div className="seg" role="group" aria-label="Water units">
          {(["g", "oz"] as const).map((u) => (
            <button key={u} type="button" className={unit === u ? "on" : ""} aria-pressed={unit === u} onClick={() => onUnit(u)}>
              {u}
            </button>
          ))}
        </div>
      </div>
      <div className="with-suffix">
        <NumInput
          id={id}
          value={grams == null ? null : unit === "oz" ? grams / G_PER_OZ : grams}
          decimals={unit === "oz" ? 1 : 1}
          min={lim ? (unit === "oz" ? lim.min / G_PER_OZ : lim.min) : undefined}
          max={lim ? (unit === "oz" ? lim.max / G_PER_OZ : lim.max) : undefined}
          onChange={(n) => onChange(n == null ? null : unit === "oz" ? Math.round(n * G_PER_OZ * 10) / 10 : n)}
        />
        <span className="suffix">{unit}</span>
      </div>
      {unit === "oz" && grams != null && <div className="hint">= {Math.round(grams)} g on the scale</div>}
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Stars({ value, onChange, label = "Rating" }: { value: number | null; onChange?: (n: number | null) => void; label?: string }) {
  return (
    <span className="stars" role={onChange ? "radiogroup" : undefined} aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className={value != null && n <= value ? "on" : ""} onClick={() => onChange(value === n ? null : n)}>★</button>
        ) : (
          <span key={n} className={value != null && n <= value ? "on" : ""}>★</span>
        ),
      )}
    </span>
  );
}

/* ------------------------------ Dialogs, history & back navigation ------------------------------
   Every full-screen dialog:
   - has a "‹ Back" button at the top-left (clear of the Dynamic Island / status area, which sits
     top-right on the iPhone Duo — the old ✕ in that corner could be unreachable);
   - adds a history entry, so the system / browser back gesture closes the top dialog instead of
     leaving the page; closing via the button removes that entry again;
   - closes on a swipe from the left edge (iOS home-screen apps have no reliable back swipe). */

type DialogEntry = { id: number; close: () => void };
const dialogStack: DialogEntry[] = [];
export const anyDialogOpen = () => dialogStack.length > 0;
let nextDialogId = 1;
let ignorePops = 0;
let popListening = false;

function ensurePopListener() {
  if (popListening) return;
  popListening = true;
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    const depth = (history.state && history.state.brewlabDialogDepth) || 0;
    const top = dialogStack[dialogStack.length - 1];
    if (!top || dialogStack.length <= depth) return;
    top.close();
    // If the dialog declined to close (e.g. "Stop this brew?" → Cancel), restore its history entry.
    setTimeout(() => {
      if (dialogStack.includes(top)) history.pushState({ brewlabDialogDepth: dialogStack.length, brewlabDialogId: top.id }, "");
    }, 80);
  });
}

/** Swipe right from the left edge → callback. */
export function useEdgeSwipeBack(onBack: () => void, enabled = true) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    let x0 = 0, y0 = 0, tracking = false, fired = false;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      tracking = e.touches.length === 1 && t.clientX <= 28;
      fired = false;
      x0 = t.clientX;
      y0 = t.clientY;
    };
    const move = (e: TouchEvent) => {
      if (!tracking || fired) return;
      const t = e.touches[0];
      const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
      if (dy > 60) tracking = false;
      else if (dx > 70) {
        fired = true;
        ref.current();
      }
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
    };
  }, [enabled]);
}

export function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="back-btn" onClick={onClick} aria-label={label === "Back" ? "Back" : `Back to ${label}`}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      <span>{label}</span>
    </button>
  );
}

/** Full-screen dialog: fixed to the viewport so it is always visible on a phone. */
export function FullScreen({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [isTop, setIsTop] = useState(true);
  const entryRef = useRef<DialogEntry | null>(null);

  useEffect(() => {
    ensurePopListener();
    const entry: DialogEntry = { id: nextDialogId++, close: () => closeRef.current() };
    entryRef.current = entry;
    dialogStack.push(entry);
    history.pushState({ brewlabDialogDepth: dialogStack.length, brewlabDialogId: entry.id }, "");
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dialogStack[dialogStack.length - 1] === entry) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    const sync = () => setIsTop(dialogStack[dialogStack.length - 1] === entry);
    const iv = window.setInterval(sync, 250);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      const i = dialogStack.indexOf(entry);
      if (i >= 0) dialogStack.splice(i, 1);
      // Closed by a button (not by the back gesture): drop the history entry we added.
      if (history.state && history.state.brewlabDialogId === entry.id) {
        ignorePops++;
        history.back();
      }
    };
  }, []);

  // Edge swipe closes only the top-most dialog.
  useEdgeSwipeBack(() => {
    if (dialogStack[dialogStack.length - 1] === entryRef.current) closeRef.current();
  }, isTop);

  // Portal to <body>: iOS WebKit confines position:fixed overlays that live inside a scrolling
  // container (the touch layout's <main>) to that container — the dialog then sat under the
  // app header with its Back button hidden. At the document root it always covers the screen.
  return createPortal(
    <div className="fullscreen" role="dialog" aria-modal="true" aria-label={title}>
      <header className="fs-head">
        <BackButton onClick={() => closeRef.current()} />
        <h2>{title}</h2>
      </header>
      <div className="fs-body">{children}</div>
      {footer && <footer className="fs-foot">{footer}</footer>}
    </div>,
    document.body,
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error" role="alert">{error}</div>;
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export const daysSince = (date: string | null | undefined) => {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - d.getTime()) / 86400000);
};

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "⋯" overflow menu for secondary actions. */
export function Menu({ items, label = "More actions" }: { items: { label: string; onClick: () => void; danger?: boolean }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? "danger" : ""} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Page header actions ------------------------------ */

/** Title-bar actions. The App renders the buttons for the current route itself (so they can't
    go missing); a button fires a named action and the visible page handles it. */
export type PageAction = "new-recipe" | "add-bag" | "log-brew" | "add-gear";
export const fireAction = (name: PageAction) => window.dispatchEvent(new CustomEvent("brewlab:action", { detail: name }));
export function useAction(name: PageAction, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent).detail === name) ref.current();
    };
    window.addEventListener("brewlab:action", h);
    return () => window.removeEventListener("brewlab:action", h);
  }, [name]);
}

const ICONS = {
  plus: "M12 5v14M5 12h14",
  calc: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 4h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h4",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  star: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z",
} as const;
export function Glyph({ name, filled = false, size = 20 }: { name: keyof typeof ICONS; filled?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
export function IconButton({ label, icon, onClick, primary = false }: { label: string; icon: keyof typeof ICONS; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" className={`icon-action ${primary ? "primary" : ""}`} aria-label={label} title={label} onClick={onClick}>
      <Glyph name={icon} />
    </button>
  );
}
/** Search input with a leading magnifier. */
export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="search-wrap">
      <Glyph name="search" size={18} />
      <input type="search" placeholder={placeholder} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ------------------------------ Temperature (stored °C, shown in the chosen unit) ------------------------------ */

export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => Math.round(((f - 32) * 5) / 9 * 10) / 10;
export function useTemp() {
  const { settings } = useData();
  const unit = settings.tempUnit;
  return {
    unit,
    label: `°${unit}`,
    fmt: (c: number | null | undefined) => (c == null ? "" : unit === "F" ? `${Math.round(cToF(c))}°F` : `${Math.round(c * 10) / 10}°C`),
  };
}
/** Temperature field: the database keeps °C; the user types in their unit. */
export function TempInput({ id, value, onChange }: { id: string; value: number | null; onChange: (c: number | null) => void }) {
  const { limits } = useData();
  const { unit } = useTemp();
  const lim = limits?.tempC;
  const f = unit === "F";
  return (
    <NumInput
      id={id}
      value={value == null ? null : f ? Math.round(cToF(value)) : value}
      onChange={(n) => onChange(n == null ? null : f ? fToC(n) : n)}
      min={lim ? (f ? Math.floor(cToF(lim.min)) : lim.min) : undefined}
      max={lim ? (f ? Math.ceil(cToF(lim.max)) : lim.max) : undefined}
      decimals={0}
    />
  );
}
