// Grind guide + positional grind converter.
//
// Conversion is POSITIONAL INTERPOLATION inside per-method ranges: a setting
// keeps its fractional position inside the source grinder's range for a brew
// method and maps to the same position in the target grinder's range for that
// method. Microns-per-click is never used for conversion.

export const METHODS = ["espresso", "pourover", "immersion", "aeropress", "rapid", "batch"] as const;
export type Method = (typeof METHODS)[number];

export const METHOD_LABELS: Record<Method, string> = {
  espresso: "Espresso",
  pourover: "Pour over (V60 / Orea)",
  immersion: "Immersion (Switch / French press)",
  aeropress: "AeroPress",
  rapid: "Rapid Brewer",
  batch: "Batch (Aiden / drip)",
};

export interface GrindRange {
  low: number;
  high: number;
}

/** Stored on gear_items.grindRanges (JSON). All fields optional except methods. */
export interface GrindRanges {
  /** Human description of the scale, e.g. "rotations, 0.1 steps". */
  scale?: string;
  /** Physical min/max of the adjustment, used for clamping. */
  min?: number | null;
  max?: number | null;
  /** Rounding step in the grinder's own units (e.g. 1 click, 0.1 rotation, 1/3 setting). */
  step?: number | null;
  /** "thirds" = Fellow Ode style notation (5.1 = 5 + 1/3, 5.2 = 5 + 2/3). */
  notation?: "decimal" | "thirds";
  /** Optional secondary readout, e.g. K-Ultra dial = clicks ÷ 10. */
  dialDivisor?: number | null;
  methods: Partial<Record<Method, GrindRange>>;
  /** Per-method notes, e.g. why a combination doesn't work. */
  notes?: Partial<Record<Method, string>>;
}

/** Approximate particle size per method (µm), interpolated by the same position. */
export const METHOD_MICRONS: Record<Method, GrindRange> = {
  espresso: { low: 200, high: 300 },
  aeropress: { low: 400, high: 550 },
  pourover: { low: 600, high: 750 },
  immersion: { low: 700, high: 900 },
  rapid: { low: 500, high: 650 },
  batch: { low: 700, high: 900 },
};

export const DRAFT_NOTE =
  "These ranges are a draft — verify them against your own dial and adjust in Gear.";

export interface GrinderLike {
  id: string;
  name: string;
  units?: string | null;
  grindRanges?: GrindRanges | null;
}

/** A grinder's ranges are whatever is saved on it — copied from the gear library when it was
    added (catalog/gear/*.json), or entered by the user. Nothing is hardcoded per model. */
export function effectiveRanges(g: GrinderLike): GrindRanges | null {
  return g.grindRanges ?? null;
}

export function rangeFor(g: GrinderLike, m: Method): GrindRange | null {
  return effectiveRanges(g)?.methods?.[m] ?? null;
}

export function noteFor(g: GrinderLike, m: Method): string | null {
  return effectiveRanges(g)?.notes?.[m] ?? null;
}

function roundTo(v: number, step: number | null | undefined): number {
  if (!step || step <= 0) return Math.round(v * 100) / 100;
  const r = Math.round(v / step) * step;
  return Math.round(r * 1000) / 1000;
}

/** Format a numeric setting in the grinder's own units. */
export function formatSetting(g: GrinderLike, value: number): string {
  const r = effectiveRanges(g);
  const units = g.units || "";
  if (r?.notation === "thirds") {
    const whole = Math.floor(value + 1e-6);
    const thirds = Math.round((value - whole) * 3);
    const label = thirds === 0 ? `${whole}` : thirds === 3 ? `${whole + 1}` : `${whole}.${thirds}`;
    return `setting ${label}`;
  }
  const step = r?.step ?? null;
  const decimals = step && step < 1 ? Math.max(1, (String(step).split(".")[1] ?? "").length) : 0;
  const num = step && step < 1 ? value.toFixed(Math.min(decimals, 2)) : String(Math.round(value));
  let out = units ? `${num} ${units}` : num;
  if (r?.dialDivisor) out += ` (dial ${(value / r.dialDivisor).toFixed(1)})`;
  return out;
}

/**
 * Parse a recorded grind-setting string into a number in the grinder's units.
 * Handles "5.0 rotations", "ZP6: 4.5-5" (range → midpoint), "72 clicks (dial 7.2)",
 * and Ode thirds notation ("setting 5.1" → 5⅓).
 */
export function parseSetting(text: string | null | undefined, g?: GrinderLike | null): number | null {
  if (!text) return null;
  let s = String(text);
  // Drop a leading "Grinder name:" prefix and any parenthetical readouts.
  if (g?.name && s.toLowerCase().startsWith(g.name.toLowerCase())) s = s.slice(g.name.length);
  s = s.replace(/^[^:]*:/, "").replace(/\([^)]*\)/g, " ");
  const range = s.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/);
  const fix = (n: number) => {
    if (g && effectiveRanges(g)?.notation === "thirds") {
      const whole = Math.floor(n);
      const frac = Math.round((n - whole) * 10);
      return whole + Math.min(frac, 2) / 3;
    }
    return n;
  };
  if (range) return (fix(parseFloat(range[1])) + fix(parseFloat(range[2]))) / 2;
  const one = s.match(/\d+(?:\.\d+)?/);
  return one ? fix(parseFloat(one[0])) : null;
}

export type ConvertResult =
  | {
      ok: true;
      value: number;
      display: string;
      position: number;
      microns: number | null;
      clamped: boolean;
    }
  | { ok: false; reason: "no-data" | "unsupported" | "no-source"; message: string; grinderId: string };

export const NO_DATA_MESSAGE = "No conversion data yet — add starting ranges for this grinder";

/** Convert `value` (source grinder units) for brew method `m` to the target grinder. */
export function convertSetting(value: number, from: GrinderLike, to: GrinderLike, m: Method): ConvertResult {
  const src = rangeFor(from, m);
  if (!src) {
    const note = noteFor(from, m);
    return note
      ? { ok: false, reason: "unsupported", message: note, grinderId: from.id }
      : { ok: false, reason: "no-source", message: `${from.name}: ${NO_DATA_MESSAGE}`, grinderId: from.id };
  }
  const dst = rangeFor(to, m);
  if (!dst) {
    const note = noteFor(to, m);
    return note
      ? { ok: false, reason: "unsupported", message: note, grinderId: to.id }
      : { ok: false, reason: "no-data", message: NO_DATA_MESSAGE, grinderId: to.id };
  }
  const span = src.high - src.low;
  const position = span === 0 ? 0.5 : (value - src.low) / span;
  let out = dst.low + position * (dst.high - dst.low);
  const r = effectiveRanges(to);
  let clamped = false;
  if (r?.min != null && out < r.min) { out = r.min; clamped = true; }
  if (r?.max != null && out > r.max) { out = r.max; clamped = true; }
  out = roundTo(out, r?.step);
  const mic = METHOD_MICRONS[m];
  const microns = Math.round(mic.low + Math.min(Math.max(position, 0), 1) * (mic.high - mic.low));
  return { ok: true, value: out, display: formatSetting(to, out), position, microns, clamped };
}

/** Starting recommendation for a grinder & method: midpoint of the range. */
export function recommend(g: GrinderLike, m: Method):
  | { ok: true; low: string; high: string; start: string; microns: GrindRange; startValue: number }
  | { ok: false; message: string; reason: "unsupported" | "no-data" } {
  const r = rangeFor(g, m);
  if (!r) {
    const note = noteFor(g, m);
    return note ? { ok: false, reason: "unsupported", message: note } : { ok: false, reason: "no-data", message: NO_DATA_MESSAGE };
  }
  const er = effectiveRanges(g);
  const mid = roundTo((r.low + r.high) / 2, er?.step);
  return {
    ok: true,
    low: formatSetting(g, r.low),
    high: formatSetting(g, r.high),
    start: formatSetting(g, mid),
    startValue: mid,
    microns: METHOD_MICRONS[m],
  };
}

/** Validate user-entered ranges. Returns an error message naming the method, or null. */
export function validateRanges(methods: Partial<Record<Method, { low?: number | null; high?: number | null }>>): string | null {
  for (const m of METHODS) {
    const r = methods[m];
    if (!r) continue;
    const hasLow = r.low != null && !Number.isNaN(r.low);
    const hasHigh = r.high != null && !Number.isNaN(r.high);
    if (hasLow !== hasHigh) return `${METHOD_LABELS[m]}: enter both a low and a high value, or leave both empty.`;
    if (hasLow && hasHigh && (r.low as number) > (r.high as number))
      return `${METHOD_LABELS[m]}: the low value (${r.low}) is above the high value (${r.high}).`;
  }
  return null;
}
