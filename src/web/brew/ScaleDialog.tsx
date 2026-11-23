import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Brew, type Recipe } from "../api";
import { FullScreen, NumInput, WaterInput, useData, Field, Stars, ErrorBox, fmtTime, fmtDate, getPref, setPref, usePref, useTemp } from "../ui";
import { scaleSteps, applyRatio, ratioOf, fmtRatio, RATIO_TOGGLES, fmtG, type LastEdited, type Step } from "../../shared/brew";
import { GrinderSwitcher, grindFor, useGrinders, methodOf } from "../grindui";
import { RatioCalculator } from "./RatioCalculator";

export interface BrewPlan {
  recipeId: number | null;
  name: string;
  brewerId: string | null;
  brewerName: string | null;
  method: Recipe["method"];
  coffee: string | null;
  doseG: number;
  waterG: number;
  tempC: number | null;
  grinderId: string | null;
  grinderName: string | null;
  grindSetting: string | null;
  steps: Step[];
  inventoryId: number | null;
  /** Grinder picked on the recipe card's switcher (converted from the original). */
  selectedGrinderId?: string | null;
}

export const planFromRecipe = (r: Recipe): BrewPlan => ({ ...r, recipeId: r.id });
export const planFromBrew = (b: Brew): BrewPlan => ({
  recipeId: b.recipeId, name: b.recipeName || "Re-brew", brewerId: b.brewerId, brewerName: b.brewerName, method: b.method,
  coffee: b.coffee, doseG: b.doseG, waterG: b.waterG, tempC: b.tempC, grinderId: b.grinderId, grinderName: b.grinderName,
  grindSetting: b.grindSetting, steps: b.steps ?? [], inventoryId: b.inventoryId,
});

/* ------------------------------ active brew (survives the PWA being closed) ------------------------------ */

export interface ActiveBrew {
  plan: BrewPlan;
  dose: number | null;
  water: number | null;
  grinderId: string | null;
  grindText: string;
  inventoryId: number | null;
  phase: "timer" | "log";
  startAt: number;
  endAt: number | null;
}
const ACTIVE_KEY = "activeBrew";
const STALE_MS = 3 * 3600 * 1000;
export function getActiveBrew(): ActiveBrew | null {
  const a = getPref<ActiveBrew | null>(ACTIVE_KEY, null);
  if (!a || !a.startAt || Date.now() - a.startAt > STALE_MS) return null;
  return a;
}
export const clearActiveBrew = () => setPref(ACTIVE_KEY, null);

/* ------------------------------ step chime ------------------------------ */

function useChime() {
  const ctx = useRef<AudioContext | null>(null);
  return {
    /** Must be called from a tap (iOS only allows audio after a user gesture). */
    unlock() {
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!ctx.current && AC) ctx.current = new AC();
        void ctx.current?.resume();
      } catch {
        /* no audio */
      }
    },
    play() {
      const c = ctx.current;
      if (!c) return;
      try {
        [0, 0.18].forEach((delay, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.frequency.value = i ? 1175 : 880;
          o.connect(g);
          g.connect(c.destination);
          const t = c.currentTime + delay;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
          o.start(t);
          o.stop(t + 0.3);
        });
      } catch {
        /* ignore */
      }
    },
  };
}

/** Keep the screen on while a brew is running (Screen Wake Lock API, where supported). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: any = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await (navigator as any).wakeLock.request("screen");
      } catch {
        /* denied (e.g. low battery) — the wall-clock timer still works */
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible" && !cancelled) acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release?.().catch(() => {});
    };
  }, [active]);
}

export function ScaleDialog({ plan, onClose, onEditGrinder, resume }: {
  plan: BrewPlan;
  onClose: () => void;
  onEditGrinder?: (id: string) => void;
  resume?: ActiveBrew;
}) {
  const { limits, gear, bags, brews, reload, toast } = useData();
  const temp = useTemp();
  const grinders = useGrinders();
  const method = methodOf(plan, gear);
  const espresso = method === "espresso";
  const waterLabel = espresso ? "Yield" : "Water";

  const [dose, setDose] = useState<number | null>(resume?.dose ?? plan.doseG);
  const [water, setWater] = useState<number | null>(resume?.water ?? plan.waterG);
  const [ratioIn, setRatioIn] = useState<number | null>(ratioOf(resume?.dose ?? plan.doseG, resume?.water ?? plan.waterG));
  const [last, setLast] = useState<LastEdited>(null);
  const [grinderId, setGrinderIdRaw] = useState<string | null>(resume?.grinderId ?? plan.selectedGrinderId ?? plan.grinderId);
  const setGrinderId = (id: string) => {
    setGrinderIdRaw(id);
    if (plan.recipeId != null) setPref(`grinder.recipe.${plan.recipeId}`, id);
  };
  const choice = grindFor(plan, grinderId, grinders, gear);
  const [grindText, setGrindText] = useState<string>(resume?.grindText ?? choice.setting ?? plan.grindSetting ?? "");
  const firstGrind = useRef(true);
  useEffect(() => {
    if (firstGrind.current) {
      firstGrind.current = false;
      return;
    }
    setGrindText(choice.setting ?? "");
  }, [grinderId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [inventoryId, setInventoryId] = useState<number | null>(resume?.inventoryId ?? plan.inventoryId);
  const [phase, setPhase] = useState<"scale" | "timer" | "log">(resume?.phase ?? "scale");
  const [startAt, setStartAt] = useState<number | null>(resume?.startAt ?? null);
  const [endAt, setEndAt] = useState<number | null>(resume?.endAt ?? null);
  const [now, setNow] = useState(Date.now());
  const [calc, setCalc] = useState(false);
  const [sound, setSound] = usePref<boolean>("sound", true);
  const chime = useChime();

  const steps = useMemo(() => (water ? scaleSteps(plan.steps, plan.waterG, water) : plan.steps), [plan, water]);
  const ratio = dose && water ? ratioOf(dose, water) : null;
  const bag = bags.find((b) => b.id === inventoryId) ?? null;
  const lowCoffee = bag && bag.remainingG != null && dose != null && dose > bag.remainingG;

  // Dial-in history: recent brews of this bag (or, without a bag, of this recipe).
  const history = useMemo(() => {
    const rel = brews.filter((b) => (inventoryId != null ? b.inventoryId === inventoryId : plan.recipeId != null && b.recipeId === plan.recipeId));
    return rel.slice(0, 3);
  }, [brews, inventoryId, plan.recipeId]);

  // Wall-clock timer: elapsed is always Date.now() - startAt, so a locked screen can't drift it.
  useEffect(() => {
    if (phase !== "timer" || !startAt || endAt) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    const vis = () => setNow(Date.now());
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [phase, startAt, endAt]);
  useWakeLock(phase === "timer");

  // Persist the running brew so it can be resumed if iOS closes the app.
  useEffect(() => {
    if ((phase === "timer" || phase === "log") && startAt)
      setPref(ACTIVE_KEY, { plan, dose, water, grinderId, grindText, inventoryId, phase, startAt, endAt } satisfies ActiveBrew);
  }, [phase, startAt, endAt, plan, dose, water, grinderId, grindText, inventoryId]);

  const elapsed = startAt ? ((endAt ?? now) - startAt) / 1000 : 0;
  const currentIdx = steps.reduce((acc, s, i) => ((s.atSec ?? 0) <= elapsed ? i : acc), 0);
  const cur = steps[currentIdx];
  const next = steps[currentIdx + 1];
  const stepStart = cur?.atSec ?? 0;
  const stepProgress = next ? Math.min(1, Math.max(0, (elapsed - stepStart) / Math.max(1, (next.atSec ?? 0) - stepStart))) : 1;

  // Chime when a new step begins.
  const lastIdx = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "timer") return;
    if (lastIdx.current !== null && currentIdx !== lastIdx.current && sound) chime.play();
    lastIdx.current = currentIdx;
  }, [currentIdx, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDoseTyped = (n: number | null) => {
    setDose(n);
    setLast("dose");
    if (n && water) setRatioIn(ratioOf(n, water));
  };
  const setWaterTyped = (n: number | null) => {
    setWater(n);
    setLast("water");
    if (n && dose) setRatioIn(ratioOf(dose, n));
  };
  const applyR = (r: number | null) => {
    setRatioIn(r);
    if (!r || !dose || !water) return;
    const out = applyRatio(dose, water, r, last);
    setDose(out.doseG);
    setWater(out.waterG);
  };

  const valid = dose != null && water != null && dose >= (limits?.doseG.min ?? 0) && water >= (limits?.waterG.min ?? 0);

  // Log form state
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [logDose, setLogDose] = useState<number | null>(resume ? resume.dose : null);
  const [logWater, setLogWater] = useState<number | null>(resume ? resume.water : null);
  const [logTime, setLogTime] = useState<number | null>(resume?.endAt ? Math.round((resume.endAt - resume.startAt) / 1000) : null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const start = () => {
    chime.unlock();
    lastIdx.current = null;
    setStartAt(Date.now());
    setNow(Date.now());
    setEndAt(null);
    setPhase("timer");
  };
  const finish = () => {
    const end = Date.now();
    setEndAt(end);
    setLogDose(dose);
    setLogWater(water);
    setLogTime(startAt ? Math.round((end - startAt) / 1000) : null);
    setPhase("log");
  };
  const close = () => {
    if (phase === "timer" && !confirm("Stop this brew? The timer will be discarded.")) return;
    clearActiveBrew();
    onClose();
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await api.post("/api/brews", {
        recipeId: plan.recipeId, recipeName: plan.name, brewerId: plan.brewerId, brewerName: plan.brewerName,
        method, coffee: bag?.name ?? plan.coffee, doseG: logDose, waterG: logWater, tempC: plan.tempC,
        grinderId: choice.grinderId, grinderName: choice.grinderName, grindSetting: grindText || null,
        steps: logWater ? scaleSteps(plan.steps, plan.waterG, logWater) : steps, inventoryId, rating, notes: notes || null,
        totalTimeSec: logTime,
      });
      clearActiveBrew();
      await reload(["brews", "bags"]);
      toast("Brew saved to the log");
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };


  const bagPicker = (id: string) => (
    <Field label="Coffee from your Stash" htmlFor={id}>
      <select id={id} value={inventoryId ?? ""} onChange={(e) => setInventoryId(e.target.value ? Number(e.target.value) : null)}>
        <option value="">— none{plan.coffee ? ` (${plan.coffee})` : ""} —</option>
        {bags.filter((b) => b.status !== "finished" || b.id === inventoryId).map((b) => (
          <option key={b.id} value={b.id}>{b.name}{b.roaster ? ` — ${b.roaster}` : ""}{b.remainingG != null ? ` · ${Math.max(0, b.remainingG)} g left` : ""}</option>
        ))}
      </select>
    </Field>
  );

  const title = phase === "scale" ? "Scale it, then brew" : phase === "timer" ? plan.name : "Save to Brew Log";
  return (
    <>
    <FullScreen
      title={title}
      onClose={close}
      footer={
        phase === "scale" ? (
          <button className="primary block" disabled={!valid} onClick={start}>Start brew</button>
        ) : phase === "timer" ? (
          <div className="row">
            <button onClick={() => { setPhase("scale"); clearActiveBrew(); }}>Back</button>
            <button className="icon-btn" aria-pressed={sound} aria-label={sound ? "Mute step chime" : "Unmute step chime"} onClick={() => { chime.unlock(); setSound(!sound); }}><BellIcon off={!sound} /></button>
            <button className="primary grow" onClick={finish}>Finish</button>
          </div>
        ) : (
          <div className="row">
            <button onClick={() => { clearActiveBrew(); onClose(); }}>Discard</button>
            <button className="primary grow" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save brew"}</button>
          </div>
        )
      }
    >
      {phase === "scale" && (
        <div className="stack">
          <div className="muted">{plan.name}{plan.brewerName ? ` · ${plan.brewerName}` : ""}{plan.tempC != null ? ` · ${temp.fmt(plan.tempC)}` : ""}</div>
          <div className="grid3">
            <Field label="Coffee (g)" htmlFor="sd-dose">
              <NumInput id="sd-dose" value={dose} onChange={setDoseTyped} min={limits?.doseG.min} max={limits?.doseG.max} decimals={1} />
            </Field>
            <WaterInput id="sd-water" label={waterLabel} grams={water} onChange={setWaterTyped} />
            <Field label="Ratio 1:" htmlFor="sd-ratio">
              <NumInput id="sd-ratio" value={ratioIn} onChange={applyR} decimals={1} min={1} max={30} />
            </Field>
          </div>
          <div className="toggles" role="group" aria-label="Ratio quick toggles">
            {RATIO_TOGGLES.map((r) => (
              <button key={r} type="button" className={ratio != null && Math.abs(ratio - r) < 0.05 ? "on" : ""} onClick={() => applyR(r)}>
                1:{r}
              </button>
            ))}
            <button type="button" className="link" onClick={() => setCalc(true)}>Ratio calculator</button>
          </div>
          <div className="hint">Ratio toggles keep {last === "water" ? `the ${waterLabel.toLowerCase()}` : "the coffee dose"} fixed (whichever you edited last).</div>

          {bagPicker("sd-bag")}
          {lowCoffee && <div className="note" role="status">Only {Math.max(0, bag!.remainingG!)} g left in this bag — less than the {dose} g dose.</div>}

          <GrinderSwitcher recipe={plan} value={grinderId} onChange={setGrinderId} idPrefix="sd" onEditGrinder={onEditGrinder} />
          <Field label="Grind setting used" htmlFor="sd-grind" hint="Converted automatically; edit or type one if there's no conversion data.">
            <input id="sd-grind" value={grindText} onChange={(e) => setGrindText(e.target.value)} />
          </Field>

          {history.length > 0 && (
            <section className="dialin" aria-label="Dial-in history" data-testid="dialin">
              <h3>Last time{bag ? ` with ${bag.name}` : ""}</h3>
              <ul className="plain small">
                {history.map((b) => (
                  <li key={b.id}>
                    <strong>{fmtDate(b.brewedAt)}</strong>{inventoryId != null && b.recipeName ? ` · ${b.recipeName}` : ""} · {b.doseG} g / {b.waterG} g
                    {b.grindSetting ? ` · ${b.grinderName ? `${b.grinderName} ` : ""}${b.grindSetting}` : ""}
                    {b.totalTimeSec != null ? ` · ${fmtTime(b.totalTimeSec)}` : ""}{b.rating ? ` · ${"★".repeat(b.rating)}` : ""}
                    {b.notes && <div className="muted">“{b.notes}”</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <h3>Pours</h3>
          <StepList steps={steps} />
          <div className="muted">Final pour lands on {water != null ? `${fmtG(water)}g` : "—"} · {fmtRatio(ratio)}</div>
        </div>
      )}

      {phase === "timer" && (
        <div className="timer">
          {resume && <div className="hint">Resumed — the timer kept running while the app was closed.</div>}
          <div className="clock" data-testid="clock">{fmtTime(elapsed)}</div>
          <div className="now-step">
            <div className="target" data-testid="timer-target">{cur?.targetWaterG != null ? `${fmtG(cur.targetWaterG)} g` : "—"}</div>
            <div className="step-label">{cur?.label}</div>
            {cur?.detail && <div className="muted">{cur.detail}</div>}
          </div>
          {next ? (
            <div className="next-step" data-testid="next-step">
              <div className="next-count">{fmtTime((next.atSec ?? 0) - elapsed)}</div>
              <div>until <strong>{next.label}</strong>{next.targetWaterG != null ? ` → ${fmtG(next.targetWaterG)} g` : ""}</div>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stepProgress * 100)}>
                <span style={{ width: `${stepProgress * 100}%` }} />
              </div>
            </div>
          ) : (
            <div className="next-step done"><div>Last step — tap <strong>Finish</strong> when it's drained.</div></div>
          )}
          <div className="muted small">Grind: {grindText || "—"} on {choice.grinderName ?? "—"} · {dose}g coffee / {water != null ? fmtG(water) : "—"}g {waterLabel.toLowerCase()}{bag ? ` · ${bag.name}` : ""}</div>
          <StepList steps={steps} active={currentIdx} />
        </div>
      )}

      {phase === "log" && (
        <div className="stack">
          <div className="muted">{plan.name} · {fmtTime(logTime ?? 0)} · grind {grindText || "—"} on {choice.grinderName ?? "—"}</div>
          <div className="grid3">
            <Field label="Coffee (g)" htmlFor="lg-dose">
              <NumInput id="lg-dose" value={logDose} onChange={setLogDose} min={limits?.doseG.min} max={limits?.doseG.max} decimals={1} />
            </Field>
            <WaterInput id="lg-water" label={waterLabel} grams={logWater} onChange={setLogWater} />
            <Field label="Total time (s)" htmlFor="lg-time">
              <NumInput id="lg-time" value={logTime} onChange={setLogTime} min={0} max={limits?.totalTimeSec.max} decimals={0} />
            </Field>
          </div>
          <Field label="Grind setting used" htmlFor="lg-grind">
            <input id="lg-grind" value={grindText} onChange={(e) => setGrindText(e.target.value)} />
          </Field>
          {bagPicker("lg-bag")}
          <Field label="Rating"><Stars value={rating} onChange={setRating} /></Field>
          <Field label="Notes" htmlFor="lg-notes"><textarea id="lg-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <ErrorBox error={error} />
        </div>
      )}
    </FullScreen>
    {/* Layered on top (not a replacement), so Back returns to the brew. */}
    {calc && <RatioCalculator onClose={() => setCalc(false)} initial={{ doseG: dose, waterG: water }} />}
    </>
  );
}

function BellIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

export function StepList({ steps, active }: { steps: Step[]; active?: number }) {
  return (
    <ol className="steps" data-testid="steps">
      {steps.map((s, i) => (
        <li key={i} className={active === i ? "active" : active != null && i < active ? "done" : ""}>
          <span className="at">{fmtTime(s.atSec ?? 0)}</span>
          <span className="lbl">{s.label}{s.detail ? <span className="muted"> — {s.detail}</span> : null}</span>
          <span className="tgt" data-testid="step-target">{s.targetWaterG != null ? `${fmtG(s.targetWaterG)} g` : ""}</span>
        </li>
      ))}
    </ol>
  );
}
