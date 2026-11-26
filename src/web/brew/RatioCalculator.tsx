import { useState } from "react";
import { FullScreen, NumInput, WaterInput, Field, useData } from "../ui";
import { applyRatio, ratioOf, RATIO_TOGGLES, fmtRatio, type LastEdited } from "../../shared/brew";

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Coffee, water and ratio fields where the ratio holds (Brew setup and the ratio calculator):
 * typing coffee moves the water, typing water moves the coffee. Only the ratio field and toggles
 * change the ratio, holding whichever of coffee/water was edited last. With the ratio field empty,
 * the two are free.
 */
export function useHeldRatio(initDose: number | null, initWater: number | null, fallbackRatio: number | null = null) {
  const [dose, setDose] = useState<number | null>(initDose);
  const [water, setWater] = useState<number | null>(initWater);
  const [ratio, setRatioIn] = useState<number | null>(initDose && initWater ? ratioOf(initDose, initWater) : fallbackRatio);
  const [last, setLast] = useState<LastEdited>(null);
  const setDoseTyped = (n: number | null) => {
    setDose(n);
    setLast("dose");
    if (n && ratio) setWater(round1(n * ratio));
    else if (n && water) setRatioIn(ratioOf(n, water));
  };
  const setWaterTyped = (n: number | null) => {
    setWater(n);
    setLast("water");
    if (n && ratio) setDose(round1(n / ratio));
    else if (n && dose) setRatioIn(ratioOf(dose, n));
  };
  const setRatio = (r: number | null) => {
    setRatioIn(r);
    if (!r || !dose || !water) return;
    const o = applyRatio(dose, water, r, last);
    setDose(o.doseG);
    setWater(o.waterG);
  };
  return { dose, water, ratio, last, setDoseTyped, setWaterTyped, setRatio };
}

export function RatioCalculator({ onClose, initial }: { onClose: () => void; initial?: { doseG: number | null; waterG: number | null } }) {
  const { limits, settings } = useData();
  const { dose, water, ratio: ratioIn, last, setDoseTyped, setWaterTyped, setRatio: set } =
    useHeldRatio(initial ? initial.doseG : 20, initial ? initial.waterG : 320, settings.defaultRatio);
  return (
    <FullScreen title="Ratio calculator" onClose={onClose}>
      <div className="stack">
        <div className="grid3">
          <Field label="Coffee (g)" htmlFor="rc-dose">
            <NumInput id="rc-dose" value={dose} decimals={1} min={limits?.doseG.min} max={limits?.doseG.max}
              onChange={setDoseTyped} />
          </Field>
          <WaterInput id="rc-water" grams={water}
            onChange={setWaterTyped} />
          <Field label="Ratio 1:" htmlFor="rc-ratio">
            <NumInput id="rc-ratio" value={ratioIn} decimals={1} min={1} max={30} onChange={set} />
          </Field>
        </div>
        <div className="toggles" role="group" aria-label="Ratio quick toggles">
          {RATIO_TOGGLES.map((r) => (
            <button key={r} type="button" onClick={() => set(r)} className={dose && water && Math.abs(water / dose - r) < 0.05 ? "on" : ""}>1:{r}</button>
          ))}
        </div>
        <div className="hint">The ratio stays put: change the coffee and the water follows, and the other way round. A new ratio keeps {last === "water" ? "the water" : "the coffee dose"} fixed (whichever you edited last).</div>
        <p className="big">{dose ?? "—"} g coffee : {water != null ? Math.round(water * 10) / 10 : "—"} g water · {fmtRatio(dose && water ? water / dose : null)}</p>
      </div>
    </FullScreen>
  );
}
