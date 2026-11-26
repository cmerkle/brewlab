import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Brew, type Recipe } from "../api";
import { FullScreen, NumInput, WaterInput, TempInput, useData, Field, Stars, fmtRating, ErrorBox, fmtTime, fmtDate, getPref, setPref, usePref, useTemp, useVocab } from "../ui";
import { scaleSteps, ratioOf, fmtRatio, RATIO_TOGGLES, fmtG, stepTimes, timerState, nextStepNow, type Step, type StepShift } from "../../shared/brew";
import { GrinderSwitcher, grindFor, grindLabel, useGrinders, methodOf } from "../grindui";
import { dosePercent, roastPercent, shiftGrind, fmtGrind, toGrindNumber } from "../../shared/grind";
import { roastLevelOf } from "../../shared/stash";
import { RatioCalculator, useHeldRatio } from "./RatioCalculator";
import { WaterSelect } from "./Water";

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
  grindSetting: number | null;
  steps: Step[];
  inventoryId: number | null;
  /** The recipe's default water recipe. */
  waterId?: number | null;
  waterName?: string | null;
  /** Grinder picked on the recipe card's switcher (converted from the original). */
  selectedGrinderId?: string | null;
  /** The roast the recipe was written for (null = the roast nudge's baseline). */
  roastLevel?: string | null;
}

export const planFromRecipe = (r: Recipe): BrewPlan => ({ ...r, recipeId: r.id });
export const planFromBrew = (b: Brew): BrewPlan => ({
  recipeId: b.recipeId, name: b.recipeName || "Re-brew", brewerId: b.brewerId, brewerName: b.brewerName, method: b.method,
  coffee: b.coffee, doseG: b.doseG, waterG: b.waterG, tempC: b.tempC, grinderId: b.grinderId, grinderName: b.grinderName,
  grindSetting: b.grindSetting, steps: b.steps ?? [], inventoryId: b.inventoryId, waterId: b.waterId, waterName: b.waterName,
});

/* ------------------------------ active brew (survives the PWA being closed) ------------------------------ */

export interface ActiveBrew {
  plan: BrewPlan;
  dose: number | null;
  water: number | null;
  grinderId: string | null;
  grind: number | null;
  tempC?: number | null;
  inventoryId: number | null;
  waterId?: number | null;
  phase: "timer" | "log";
  startAt: number;
  endAt: number | null;
  /** "Next step now" moves (older versions: none). */
  shifts?: StepShift[];
  /** "Wait": the step held until you tap Next step now. */
  waitFor?: number | null;
}
const ACTIVE_KEY = "activeBrew";
const STALE_MS = 3 * 3600 * 1000;
export function getActiveBrew(): ActiveBrew | null {
  const a = getPref<ActiveBrew | null>(ACTIVE_KEY, null);
  if (!a || !a.startAt || Date.now() - a.startAt > STALE_MS) return null;
  // Saved by an older version: grind was free text.
  if (a.grind === undefined) a.grind = toGrindNumber((a as any).grindText);
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
        // iOS (Safari 16.4+): "playback" lets the chime sound with the ring/silent switch on silent.
        // Ignored where the Audio Session API doesn't exist. Set back to "auto" by release().
        const session = (navigator as any).audioSession;
        if (session && session.type !== "playback") session.type = "playback";
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!ctx.current && AC) ctx.current = new AC();
        void ctx.current?.resume();
      } catch {
        /* no audio */
      }
    },
    /** The brew screen is closing: give the audio session back to the system default. */
    release() {
      try {
        const session = (navigator as any).audioSession;
        if (session && session.type === "playback") session.type = "auto";
      } catch {
        /* ignore */
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
  const { limits, gear, bags, brews, recipes, water: waters, reload, toast, settings } = useData();
  const vocab = useVocab();
  const temp = useTemp();
  const grinders = useGrinders();
  const method = methodOf(plan, gear);
  const espresso = method === "espresso";
  const waterLabel = espresso ? "Yield" : "Water";

  const { dose, water, ratio: ratioIn, last, setDoseTyped, setWaterTyped, setRatio: applyR } =
    useHeldRatio(resume?.dose ?? plan.doseG, resume?.water ?? plan.waterG);
  const [grinderId, setGrinderIdRaw] = useState<string | null>(resume?.grinderId ?? plan.selectedGrinderId ?? plan.grinderId);
  const setGrinderId = (id: string) => {
    setGrinderIdRaw(id);
    if (plan.recipeId != null) setPref(`grinder.recipe.${plan.recipeId}`, id);
  };
  const choice = grindFor(plan, grinderId, grinders, gear);
  const grinder = grinders.find((g) => g.id === choice.grinderId) ?? null;
  const [tempC, setTempC] = useState<number | null>(resume?.tempC !== undefined ? resume.tempC : plan.tempC);
  const [inventoryId, setInventoryId] = useState<number | null>(resume?.inventoryId ?? plan.inventoryId);
  const [waterId, setWaterId] = useState<number | null>(resume?.waterId !== undefined ? resume.waterId : plan.waterId ?? null);
  const waterRec = waters.find((w) => w.id === waterId) ?? null;
  const [phase, setPhase] = useState<"setup" | "timer" | "log">(resume?.phase ?? "setup");
  const [startAt, setStartAt] = useState<number | null>(resume?.startAt ?? null);
  const [endAt, setEndAt] = useState<number | null>(resume?.endAt ?? null);
  const [shifts, setShifts] = useState<StepShift[]>(resume?.shifts ?? []);
  const [waitFor, setWaitFor] = useState<number | null>(resume?.waitFor ?? null);
  const [now, setNow] = useState(Date.now());
  const [calc, setCalc] = useState(false);
  const [sound, setSound] = usePref<boolean>("sound", true);
  const chime = useChime();
  useEffect(() => () => chime.release(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Grind: the recipe's (converted to the chosen grinder), moved for the bag's roast and the dose
  // (both settings) — until you type your own number.
  const bag = bags.find((b) => b.id === inventoryId) ?? null;
  const bagRoast = roastLevelOf(bag?.roastLevel, vocab.roastLevels);
  const recipeRoast = roastLevelOf(plan.roastLevel ?? recipes.find((r) => r.id === plan.recipeId)?.roastLevel, vocab.roastLevels);
  const roastAdj = roastPercent(method, bagRoast, recipeRoast, vocab.roastLevels, settings.roastNudge);
  const dosePct = dose ? dosePercent(method, plan.doseG, dose, settings.doseNudge) : 0;
  const nudge = grinder && choice.setting != null ? shiftGrind(grinder, method, choice.setting, dosePct + (roastAdj?.percent ?? 0)) : null;
  const suggested = nudge?.dial ?? choice.setting;
  const [typedGrind, setTypedGrind] = useState<{ value: number | null } | null>(resume ? { value: resume.grind } : null);
  const grind = typedGrind ? typedGrind.value : suggested;
  const firstGrinder = useRef(true);
  useEffect(() => {
    if (firstGrinder.current) {
      firstGrinder.current = false;
      return;
    }
    setTypedGrind(null); // another grinder: start from its converted setting
  }, [grinderId]);

  const steps = useMemo(() => (water ? scaleSteps(plan.steps, plan.waterG, water) : plan.steps), [plan, water]);
  const ratio = dose && water ? ratioOf(dose, water) : null;
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
      setPref(ACTIVE_KEY, { plan, dose, water, grinderId, grind, tempC, inventoryId, waterId, phase: phase as "timer" | "log", startAt, endAt, shifts, waitFor } satisfies ActiveBrew);
  }, [phase, startAt, endAt, shifts, waitFor, plan, dose, water, grinderId, grind, tempC, inventoryId, waterId]);

  const elapsed = startAt ? ((endAt ?? now) - startAt) / 1000 : 0;
  // Step times after any "Next step now" / "Wait" (each step keeps its duration; the clock stays real time).
  const times = useMemo(() => stepTimes(steps, shifts), [steps, shifts]);
  const { idx: currentIdx, holding } = timerState(times, elapsed, waitFor);
  const cur = steps[currentIdx];
  const next = steps[currentIdx + 1];
  const stepStart = times[currentIdx] ?? 0;
  const nextAt = times[currentIdx + 1] ?? 0;
  const stepProgress = next ? Math.min(1, Math.max(0, (elapsed - stepStart) / Math.max(1, nextAt - stepStart))) : 1;
  const running = phase === "timer" && !!startAt && !endAt;
  const goNext = () => {
    const t = Date.now();
    setNow(t);
    setShifts(nextStepNow(steps, shifts, currentIdx, startAt ? (t - startAt) / 1000 : 0));
    setWaitFor(null);
  };

  // Chime when a new step begins.
  const lastIdx = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "timer") return;
    if (lastIdx.current !== null && currentIdx !== lastIdx.current && sound) chime.play();
    lastIdx.current = currentIdx;
  }, [currentIdx, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ratio holds (useHeldRatio): typing coffee moves the water and typing water moves the coffee.

  const valid = dose != null && water != null && dose >= (limits?.doseG.min ?? 0) && water >= (limits?.waterG.min ?? 0);

  // Log form state
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [logDose, setLogDose] = useState<number | null>(resume ? resume.dose : null);
  const [logWater, setLogWater] = useState<number | null>(resume ? resume.water : null);
  const [logTime, setLogTime] = useState<number | null>(resume?.endAt ? Math.round((resume.endAt - resume.startAt) / 1000) : null);
  const [logTemp, setLogTemp] = useState<number | null>(resume?.tempC !== undefined ? resume.tempC : plan.tempC);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Setup done: show the timer, not running yet — Start begins it when you pour. */
  const ready = () => {
    lastIdx.current = null;
    setStartAt(null);
    setEndAt(null);
    setPhase("timer");
  };
  const start = () => {
    chime.unlock();
    lastIdx.current = 0; // the first step is on screen; the next change chimes
    setStartAt(Date.now());
    setNow(Date.now());
    setEndAt(null);
    setShifts([]);
    setWaitFor(null);
    setPhase("timer");
  };
  const finish = () => {
    const end = Date.now();
    setEndAt(end);
    setLogDose(dose);
    setLogWater(water);
    setLogTemp(tempC);
    setLogTime(startAt ? Math.round((end - startAt) / 1000) : null);
    setPhase("log");
  };
  const close = () => {
    if (phase === "timer" && startAt && !confirm("Stop this brew? The timer will be discarded.")) return;
    clearActiveBrew();
    onClose();
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await api.post("/api/brews", {
        recipeId: plan.recipeId, recipeName: plan.name, brewerId: plan.brewerId, brewerName: plan.brewerName,
        method, coffee: bag?.name ?? plan.coffee, doseG: logDose, waterG: logWater, tempC: logTemp,
        grinderId: choice.grinderId, grinderName: choice.grinderName, grindSetting: grind,
        steps: logWater ? scaleSteps(plan.steps, plan.waterG, logWater) : steps, inventoryId, rating, notes: notes || null,
        totalTimeSec: logTime, waterId,
      });
      clearActiveBrew();
      await reload(["brews", "bags", "water"]);
      toast("Brew saved to the log");
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };


  const waterPicker = (id: string) => (
    <WaterSelect id={id} value={waterId} onChange={setWaterId} keptName={waterId == null && plan.waterId == null ? plan.waterName : null} />
  );
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

  const grindField = (id: string, hint?: string) => (
    <Field label={`Grind setting${grinder?.units ? ` (${grinder.units})` : ""}`} htmlFor={id} hint={hint}>
      <NumInput id={id} value={grind} onChange={(n) => setTypedGrind({ value: n })} min={0} max={10000} decimals={2} />
    </Field>
  );

  const title = phase === "setup" ? "Brew setup" : phase === "timer" ? plan.name : "Save to Brew Log";
  return (
    <>
    <FullScreen
      title={title}
      onClose={close}
      bodyClassName={phase === "timer" ? "pinned" : undefined}
      footer={
        phase === "setup" ? (
          <button className="primary block" disabled={!valid} onClick={ready}>Ready to brew</button>
        ) : phase === "timer" ? (
          <div className="row">
            <button onClick={() => { setPhase("setup"); setStartAt(null); clearActiveBrew(); }}>Back</button>
            <button className="icon-btn" aria-pressed={sound} aria-label={sound ? "Mute step chime" : "Unmute step chime"} onClick={() => { chime.unlock(); if (!sound) chime.play(); setSound(!sound); }}><BellIcon off={!sound} /></button>
            {startAt ? (
              <button className="primary grow" onClick={finish}>Finish</button>
            ) : (
              <button className="primary grow" onClick={start}>Start timer</button>
            )}
          </div>
        ) : (
          <div className="row">
            <button onClick={() => { clearActiveBrew(); onClose(); }}>Discard</button>
            <button className="primary grow" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save brew"}</button>
          </div>
        )
      }
    >
      {phase === "setup" && (
        <div className="stack">
          <div className="muted">{plan.name}{plan.brewerName ? ` · ${plan.brewerName}` : ""}</div>
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
          <div className="hint">The ratio stays put: change the coffee and the {waterLabel.toLowerCase()} follows, and the other way round. A new ratio keeps {last === "water" ? `the ${waterLabel.toLowerCase()}` : "the coffee dose"} fixed (whichever you edited last).</div>
          <Field label={`Water temperature (${temp.label})`} htmlFor="sd-temp">
            <TempInput id="sd-temp" value={tempC} onChange={setTempC} />
          </Field>

          {bagPicker("sd-bag")}
          {(waters.length > 0 || plan.waterName) && waterPicker("sd-waterrec")}
          {lowCoffee && <div className="note" role="status">Only {Math.max(0, bag!.remainingG!)} g left in this bag — less than the {dose} g dose.</div>}

          <GrinderSwitcher recipe={plan} value={grinderId} onChange={setGrinderId} idPrefix="sd" onEditGrinder={onEditGrinder} />
          {grindField("sd-grind", typedGrind ? undefined : "Converted automatically; type your own number if you like.")}
          {nudge && !typedGrind && choice.setting != null && (
            <div className="hint" role="status" data-testid="grind-nudge">
              {[
                roastAdj && bagRoast && `${bagRoast.label} roast ${roastAdj.assumed ? `(recipes count as ${roastAdj.from.label.toLowerCase()} unless set)` : `for a ${roastAdj.from.label.toLowerCase()} recipe`}, so ${roastAdj.percent > 0 ? "coarser" : "finer"}`,
                dosePct && `${dose! > plan.doseG ? "bigger" : "smaller"} dose than the recipe's ${fmtG(plan.doseG)} g, so ${dosePct > 0 ? "coarser" : "finer"}`,
              ].filter(Boolean).join("; ").replace(/^./, (c) => c.toUpperCase())}
              : {fmtGrind(nudge.dial, grinder)} instead of {fmtGrind(choice.setting, grinder)}.{" "}
              <button type="button" className="link" onClick={() => setTypedGrind({ value: choice.setting })}>Use {fmtGrind(choice.setting, grinder)}</button>
            </div>
          )}

          {history.length > 0 && (
            <section className="dialin" aria-label="Dial-in history" data-testid="dialin">
              <h3>Last time{bag ? ` with ${bag.name}` : ""}</h3>
              <ul className="plain small">
                {history.map((b) => (
                  <li key={b.id}>
                    <strong>{fmtDate(b.brewedAt)}</strong>{inventoryId != null && b.recipeName ? ` · ${b.recipeName}` : ""} · {b.doseG} g / {b.waterG} g
                    {b.grindSetting != null ? ` · ${grindLabel(b, gear)}` : ""}
                    {b.tempC != null ? ` · ${temp.fmt(b.tempC)}` : ""}
                    {b.totalTimeSec != null ? ` · ${fmtTime(b.totalTimeSec)}` : ""}{b.rating ? ` · ${fmtRating(b.rating)}★` : ""}
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
          {resume && startAt && <div className="hint">Resumed — the timer kept running while the app was closed.</div>}
          {!startAt && <div className="hint" data-testid="timer-ready">Set up and ready — tap <strong>Start timer</strong> when you start pouring.</div>}
          <div className="clock" data-testid="clock">{fmtTime(elapsed)}</div>
          <div className="now-step">
            <div className="target" data-testid="timer-target">{cur?.targetWaterG != null ? `${fmtG(cur.targetWaterG)} g` : "—"}</div>
            <div className="step-label">{cur?.label}</div>
            {cur?.detail && <div className="muted">{cur.detail}</div>}
          </div>
          {next ? (
            <div className={`next-step${holding ? " holding" : ""}`} data-testid="next-step">
              {holding ? (
                <>
                  <div className="next-count" data-testid="wait-count">+{fmtTime(elapsed - nextAt)}</div>
                  <div>Waiting — tap <strong>Next step now</strong> for <strong>{next.label}</strong>{next.targetWaterG != null ? ` → ${fmtG(next.targetWaterG)} g` : ""}</div>
                </>
              ) : (
                <>
                  <div className="next-count">{fmtTime(nextAt - elapsed)}</div>
                  <div>{waitFor != null ? "then wait for " : "until "}<strong>{next.label}</strong>{next.targetWaterG != null ? ` → ${fmtG(next.targetWaterG)} g` : ""}</div>
                  <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stepProgress * 100)}>
                    <span style={{ width: `${stepProgress * 100}%` }} />
                  </div>
                </>
              )}
              {running && (
                <div className="step-ctl">
                  {!holding && (
                    <button type="button" aria-pressed={waitFor != null} className={waitFor != null ? "on" : ""} onClick={() => setWaitFor(waitFor != null ? null : currentIdx + 1)}>
                      Wait
                    </button>
                  )}
                  <button type="button" className={holding ? "primary" : ""} onClick={goNext}>Next step now</button>
                </div>
              )}
            </div>
          ) : (
            <div className="next-step done"><div>Last step — tap <strong>Finish</strong> when it's drained.</div></div>
          )}
          <div className="muted small">Grind: {fmtGrind(grind, grinder) || "—"} on {choice.grinderName ?? "—"}{tempC != null ? ` · ${temp.fmt(tempC)}` : ""} · {dose}g coffee / {water != null ? fmtG(water) : "—"}g {waterLabel.toLowerCase()}{bag ? ` · ${bag.name}` : ""}{waterRec ? ` · ${waterRec.name}` : ""}</div>
          <StepList steps={steps} active={currentIdx} times={times} follow />
        </div>
      )}

      {phase === "log" && (
        <div className="stack">
          <div className="muted">{plan.name} · {fmtTime(logTime ?? 0)} · grind {fmtGrind(grind, grinder) || "—"} on {choice.grinderName ?? "—"}</div>
          <div className="grid3">
            <Field label="Coffee (g)" htmlFor="lg-dose">
              <NumInput id="lg-dose" value={logDose} onChange={setLogDose} min={limits?.doseG.min} max={limits?.doseG.max} decimals={1} />
            </Field>
            <WaterInput id="lg-water" label={waterLabel} grams={logWater} onChange={setLogWater} />
            <Field label="Total time (s)" htmlFor="lg-time">
              <NumInput id="lg-time" value={logTime} onChange={setLogTime} min={0} max={limits?.totalTimeSec.max} decimals={0} />
            </Field>
          </div>
          <div className="grid2">
            {grindField("lg-grind")}
            <Field label={`Water temperature (${temp.label})`} htmlFor="lg-temp">
              <TempInput id="lg-temp" value={logTemp} onChange={setLogTemp} />
            </Field>
          </div>
          {bagPicker("lg-bag")}
          {(waters.length > 0 || plan.waterName) && waterPicker("lg-waterrec")}
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


/** `follow`: the list scrolls itself (not the page) to keep the active step in view, with the step before it peeking above. */
export function StepList({ steps, active, follow, times }: { steps: Step[]; active?: number; follow?: boolean; times?: number[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const ol = ref.current;
    if (!follow || !ol || active == null) return;
    const li = ol.children[active] as HTMLElement | undefined;
    if (!li) return;
    const prev = ol.children[active - 1] as HTMLElement | undefined;
    const top = prev ? prev.offsetTop + prev.offsetHeight / 2 : li.offsetTop;
    ol.scrollTo({ top: Math.max(0, top), behavior: "smooth" }); // offsets are relative to the ol (position: relative)
  }, [active, follow]);
  return (
    <ol ref={ref} className={follow ? "steps follow" : "steps"} data-testid="steps">
      {steps.map((s, i) => (
        <li key={i} className={active === i ? "active" : active != null && i < active ? "done" : ""}>
          <span className="at">{fmtTime(times?.[i] ?? s.atSec ?? 0)}</span>
          <span className="lbl">{s.label}{s.detail ? <span className="muted"> — {s.detail}</span> : null}</span>
          <span className="tgt" data-testid="step-target">{s.targetWaterG != null ? `${fmtG(s.targetWaterG)} g` : ""}</span>
        </li>
      ))}
    </ol>
  );
}
