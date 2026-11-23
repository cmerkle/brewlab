// Ratio / scaling maths. Pour steps scale off WATER, never off dose.

export interface Step {
  label: string;
  detail?: string | null;
  targetWaterG?: number | null;
  atSec?: number | null;
}

export const G_PER_OZ = 28.349523125;
export const RATIO_TOGGLES = [13, 14, 15, 16, 16.7, 17, 2] as const;

export const gToOz = (g: number) => g / G_PER_OZ;
export const ozToG = (oz: number) => oz * G_PER_OZ;

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/**
 * Rescale every pour target from the recipe's base water to the entered water.
 * Any step that sat on the base total lands exactly on the new total; other
 * targets are proportional and rounded to whole grams.
 */
export function scaleSteps(steps: Step[], baseWaterG: number, newWaterG: number): Step[] {
  if (!baseWaterG || baseWaterG <= 0) return steps.map((s) => ({ ...s }));
  const k = newWaterG / baseWaterG;
  return steps.map((s) => {
    if (s.targetWaterG == null) return { ...s };
    const t = s.targetWaterG >= baseWaterG - 1e-9 ? newWaterG : Math.round(s.targetWaterG * k);
    return { ...s, targetWaterG: Math.min(t, Math.round(newWaterG * 10) / 10), label: relabel(s.label, s.targetWaterG, t) };
  });
}

/** "Pour to 160g" → "Pour to 230g" when the target changes. */
function relabel(label: string, oldT: number, newT: number): string {
  if (!label) return label;
  const re = new RegExp(`\\b${String(oldT).replace(".", "\\.")}\\s?g\\b`);
  return re.test(label) ? label.replace(re, `${fmtG(newT)}g`) : label;
}

export function fmtG(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function ratioOf(doseG: number, waterG: number): number | null {
  if (!doseG || doseG <= 0 || !waterG) return null;
  return waterG / doseG;
}

export function fmtRatio(r: number | null): string {
  if (r == null || !Number.isFinite(r)) return "—";
  return `1:${round1(r)}`;
}

export type LastEdited = "dose" | "water" | null;

/**
 * Apply a ratio (quick-toggle or typed). Holds whichever of coffee / water the
 * user edited last; if neither has been edited, holds the coffee dose.
 */
export function applyRatio(doseG: number, waterG: number, ratio: number, lastEdited: LastEdited) {
  if (lastEdited === "water") {
    return { doseG: round1(waterG / ratio), waterG };
  }
  return { doseG, waterG: Math.round(doseG * ratio * 10) / 10 };
}
