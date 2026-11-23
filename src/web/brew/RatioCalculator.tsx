import { useState } from "react";
import { FullScreen, NumInput, WaterInput, Field, useData } from "../ui";
import { applyRatio, ratioOf, RATIO_TOGGLES, fmtRatio, type LastEdited } from "../../shared/brew";

export function RatioCalculator({ onClose, initial }: { onClose: () => void; initial?: { doseG: number | null; waterG: number | null } }) {
  const { limits, settings } = useData();
  const [dose, setDose] = useState<number | null>(initial?.doseG ?? 20);
  const [water, setWater] = useState<number | null>(initial?.waterG ?? 320);
  const [ratioIn, setRatioIn] = useState<number | null>(dose && water ? ratioOf(dose, water) : settings.defaultRatio);
  const [last, setLast] = useState<LastEdited>(null);

  const set = (r: number | null) => {
    setRatioIn(r);
    if (!r || !dose || !water) return;
    const o = applyRatio(dose, water, r, last);
    setDose(o.doseG);
    setWater(o.waterG);
  };
  return (
    <FullScreen title="Ratio calculator" onClose={onClose}>
      <div className="stack">
        <div className="grid3">
          <Field label="Coffee (g)" htmlFor="rc-dose">
            <NumInput id="rc-dose" value={dose} decimals={1} min={limits?.doseG.min} max={limits?.doseG.max}
              onChange={(n) => { setDose(n); setLast("dose"); if (n && water) setRatioIn(ratioOf(n, water)); }} />
          </Field>
          <WaterInput id="rc-water" grams={water}
            onChange={(n) => { setWater(n); setLast("water"); if (n && dose) setRatioIn(ratioOf(dose, n)); }} />
          <Field label="Ratio 1:" htmlFor="rc-ratio">
            <NumInput id="rc-ratio" value={ratioIn} decimals={1} min={1} max={30} onChange={set} />
          </Field>
        </div>
        <div className="toggles" role="group" aria-label="Ratio quick toggles">
          {RATIO_TOGGLES.map((r) => (
            <button key={r} type="button" onClick={() => set(r)} className={dose && water && Math.abs(water / dose - r) < 0.05 ? "on" : ""}>1:{r}</button>
          ))}
        </div>
        <p className="big">{dose ?? "—"} g coffee : {water != null ? Math.round(water * 10) / 10 : "—"} g water · {fmtRatio(dose && water ? water / dose : null)}</p>
      </div>
    </FullScreen>
  );
}
