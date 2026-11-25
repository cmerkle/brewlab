// Grind guide + positional grind converter.
//
// Conversion is POSITIONAL INTERPOLATION inside per-method ranges: a setting
// keeps its fractional position inside the source grinder's range for a brew
// method and maps to the same position in the target grinder's range for that
// method. Microns-per-click is never used for conversion.

// Order = finest to coarsest, as grind charts list them. "batch" is a drip coffee maker,
// "immersion" a French press (or Switch/Clever full immersion). Rapid Brewer last (OXO).
// Finest → coarsest (the order every table, list and picker uses).
export const METHODS = ["turkish", "espresso", "moka", "aeropress", "rapid", "pourover", "batch", "immersion", "coldbrew"] as const;
export type Method = (typeof METHODS)[number];

export const METHOD_LABELS: Record<Method, string> = {
  turkish: "Turkish",
  espresso: "Espresso",
  moka: "Moka pot",
  aeropress: "AeroPress",
  rapid: "Rapid Brewer",
  pourover: "Pour-over (V60)",
  batch: "Drip coffee maker",
  immersion: "French press / immersion",
  coldbrew: "Cold brew",
};

/** The grind category a kind of brewer uses by default (a brewer's own defaultMethod wins). */
export const CATEGORY_METHOD: Record<string, Method> = {
  "cone-dripper": "pourover",
  "flat-bottom-dripper": "pourover",
  "hybrid-dripper": "pourover",
  "immersion-dripper": "immersion",
  "aeropress": "aeropress",
  "rapid-brewer": "rapid",
  "french-press": "immersion",
  "moka-pot": "moka",
  "espresso-machine": "espresso",
  "batch-brewer": "batch",
  "cezve": "turkish",
  "cold-brew-maker": "coldbrew",
  "siphon": "pourover",
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
  /** Brew methods this grinder can't do (unticked "can do" in the gear editor). Never have a range. */
  unsupported?: Method[];
}

/** Approximate particle size per method (µm), interpolated by the same position. */
export const METHOD_MICRONS: Record<Method, GrindRange> = {
  turkish: { low: 100, high: 200 },
  espresso: { low: 200, high: 300 },
  moka: { low: 350, high: 500 },
  aeropress: { low: 400, high: 550 },
  pourover: { low: 600, high: 750 },
  batch: { low: 550, high: 750 },
  immersion: { low: 700, high: 900 },
  coldbrew: { low: 850, high: 1100 },
  rapid: { low: 500, high: 650 },
};

export const DRAFT_NOTE =
  "Starting points from each grinder's ranges in Gear (where they come from is noted there) — dial in from here.";

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

/** Whether the grinder can be used for this brew method (all can, unless marked otherwise). */
export function canGrind(g: GrinderLike, m: Method): boolean {
  return !effectiveRanges(g)?.unsupported?.includes(m);
}

export function rangeFor(g: GrinderLike, m: Method): GrindRange | null {
  return canGrind(g, m) ? effectiveRanges(g)?.methods?.[m] ?? null : null;
}

/** Why a grinder has no range for a method: it can't do it, a note, or no data yet. */
export function missingRange(g: GrinderLike, m: Method): { reason: "unsupported" | "no-data"; message: string } {
  const note = noteFor(g, m);
  if (!canGrind(g, m)) return { reason: "unsupported", message: `${g.name} can't grind for ${METHOD_LABELS[m]}.${note ? ` ${note}` : ""}` };
  if (note) return { reason: "unsupported", message: note };
  return { reason: "no-data", message: `${g.name}: ${NO_DATA_MESSAGE}` };
}

export function noteFor(g: GrinderLike, m: Method): string | null {
  return effectiveRanges(g)?.notes?.[m] ?? null;
}

function roundTo(v: number, step: number | null | undefined): number {
  if (!step || step <= 0) return Math.round(v * 100) / 100;
  const r = Math.round(v / step) * step;
  return Math.round(r * 1000) / 1000;
}

/* Grind settings are plain numbers: exactly what you set on the grinder (88 on a K-Ultra counted
   in clicks, 5.0 rotations on a ZP6, 5.1 on a Fellow Ode). The math below works on the
   grinder's linear scale ("value"); the stored/typed number is the "dial" reading. They only
   differ for "thirds" notation (Ode: dial 5.1 = value 5⅓). */

/** Dial reading → linear value (Ode thirds: 5.1 → 5⅓). */
export function dialToValue(g: GrinderLike, dial: number): number {
  if (effectiveRanges(g)?.notation !== "thirds") return dial;
  const whole = Math.floor(dial + 1e-9);
  const sub = Math.min(Math.round((dial - whole) * 10), 2);
  return whole + sub / 3;
}

/** Linear value → dial reading, rounded to the grinder's step. */
export function valueToDial(g: GrinderLike, value: number): number {
  const r = effectiveRanges(g);
  if (r?.notation === "thirds") {
    let whole = Math.floor(value + 1e-6);
    let thirds = Math.round((value - whole) * 3);
    if (thirds === 3) { whole += 1; thirds = 0; }
    return whole + thirds / 10;
  }
  return roundTo(value, r?.step);
}

function stepDecimals(g: GrinderLike | null | undefined): number | null {
  const r = g ? effectiveRanges(g) : null;
  if (r?.notation === "thirds") return null;
  const step = r?.step;
  if (!step || step >= 1) return step ? 0 : null;
  return Math.min(Math.max(1, (String(step).split(".")[1] ?? "").length), 2);
}

/** The number alone, as the grinder shows it ("88", "5.0", "5.1", "15"). */
export function fmtGrindNumber(dial: number, g?: GrinderLike | null): string {
  const d = stepDecimals(g);
  if (d != null) return dial.toFixed(d);
  return String(Math.round(dial * 100) / 100);
}

/** Number plus the grinder's unit word, if it has one ("88 clicks", "5.0 rotations", "5.1"). */
export function fmtGrind(dial: number | null | undefined, g?: GrinderLike | null): string {
  if (dial == null || Number.isNaN(dial)) return "";
  const n = fmtGrindNumber(dial, g);
  return g?.units ? `${n} ${g.units}` : n;
}

/** Kept for callers that think in linear values: value → "88 clicks". */
export function formatSetting(g: GrinderLike, value: number): string {
  return fmtGrind(valueToDial(g, value), g);
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

/** Legacy text ("72 clicks (dial 7.2)", "ZP6: 4.5-5", "setting 5.1") or a number → dial number. */
export function toGrindNumber(x: unknown, g?: GrinderLike | null): number | null {
  if (x == null || x === "") return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const s = String(x).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const v = parseSetting(s, g);
  if (v == null) return null;
  return g ? valueToDial(g, v) : Math.round(v * 1000) / 1000;
}

export type ConvertResult =
  | {
      ok: true;
      /** Dial number on the target grinder. */
      value: number;
      display: string;
      position: number;
      microns: number | null;
      clamped: boolean;
    }
  | { ok: false; reason: "no-data" | "unsupported" | "no-source"; message: string; grinderId: string };

export const NO_DATA_MESSAGE = "No conversion data yet — add starting ranges for this grinder";

/** Convert a dial number on `from` for brew method `m` to a dial number on `to`. */
export function convertSetting(dial: number, from: GrinderLike, to: GrinderLike, m: Method): ConvertResult {
  const value = dialToValue(from, dial);
  const src = rangeFor(from, m);
  if (!src) {
    const why = missingRange(from, m);
    return { ok: false, reason: why.reason === "no-data" ? "no-source" : "unsupported", message: why.message, grinderId: from.id };
  }
  const dst = rangeFor(to, m);
  if (!dst) {
    const why = missingRange(to, m);
    return { ok: false, reason: why.reason, message: why.reason === "no-data" ? NO_DATA_MESSAGE : why.message, grinderId: to.id };
  }
  const span = src.high - src.low;
  const position = span === 0 ? 0.5 : (value - src.low) / span;
  let out = dst.low + position * (dst.high - dst.low);
  const r = effectiveRanges(to);
  let clamped = false;
  if (r?.min != null && out < r.min) { out = r.min; clamped = true; }
  if (r?.max != null && out > r.max) { out = r.max; clamped = true; }
  const outDial = valueToDial(to, out);
  const mic = METHOD_MICRONS[m];
  const microns = Math.round(mic.low + Math.min(Math.max(position, 0), 1) * (mic.high - mic.low));
  return { ok: true, value: outDial, display: fmtGrind(outDial, to), position, microns, clamped };
}

/** Starting recommendation for a grinder & method: midpoint of the range. */
export function recommend(g: GrinderLike, m: Method):
  | { ok: true; low: string; high: string; start: string; microns: GrindRange; startValue: number }
  | { ok: false; message: string; reason: "unsupported" | "no-data" } {
  const r = rangeFor(g, m);
  if (!r) {
    const why = missingRange(g, m);
    return { ok: false, reason: why.reason, message: why.reason === "no-data" ? NO_DATA_MESSAGE : why.message };
  }
  const mid = valueToDial(g, (r.low + r.high) / 2);
  return {
    ok: true,
    low: formatSetting(g, r.low),
    high: formatSetting(g, r.high),
    start: fmtGrind(mid, g),
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

/* ------------------------------ dose → grind nudge ------------------------------ */

/**
 * How Brew setup adjusts the grind for a different dose (a setting: More → Settings).
 * `percent` = share of the grinder's range for that method to move per doubling (or halving).
 */
export interface DoseNudge { enabled: boolean; percent: number; methods: Method[] }
/** Defaults: drip methods, where a bigger bed drains slower and wants a coarser grind. */
export const DEFAULT_DOSE_NUDGE: DoseNudge = { enabled: true, percent: 20, methods: ["rapid", "pourover", "batch"] };

/** How far the dose nudge moves the grind, in % of the method range (0 = not at all). */
export function dosePercent(m: Method, recipeDoseG: number, doseG: number, cfg: DoseNudge = DEFAULT_DOSE_NUDGE): number {
  if (!cfg.enabled || !(cfg.percent > 0) || !cfg.methods.includes(m)) return 0;
  if (!(recipeDoseG > 0) || !(doseG > 0) || doseG === recipeDoseG) return 0;
  return cfg.percent * Math.log2(doseG / recipeDoseG);
}

/**
 * Move a setting by `percent` of the grinder's range for the method (positive = coarser), kept
 * inside the grinder's dial and rounded to its step. Null when nothing changes (no range, 0%, or
 * the step rounds it away).
 */
export function shiftGrind(g: GrinderLike, m: Method, dial: number, percent: number): { dial: number; delta: number } | null {
  if (!percent) return null;
  const r = rangeFor(g, m);
  if (!r || r.high <= r.low) return null;
  const er = effectiveRanges(g);
  let v = dialToValue(g, dial) + (percent / 100) * (r.high - r.low);
  if (er?.min != null) v = Math.max(er.min, v);
  if (er?.max != null) v = Math.min(er.max, v);
  const out = valueToDial(g, v);
  const delta = Math.round((dialToValue(g, out) - dialToValue(g, dial)) * 1000) / 1000;
  if (Math.abs(delta) < 1e-9) return null;
  return { dial: out, delta };
}

/**
 * Grind for a different dose than the recipe's: the chosen methods move coarser (bigger dose) or
 * finer (smaller dose) by `cfg.percent` of the method range per doubling. Returns null when
 * nothing changes (turned off, other methods, no range, same dose, or the step rounds it away).
 */
export function doseAdjustedGrind(
  g: GrinderLike, m: Method, dial: number, recipeDoseG: number, doseG: number, cfg: DoseNudge = DEFAULT_DOSE_NUDGE,
): { dial: number; delta: number } | null {
  return shiftGrind(g, m, dial, dosePercent(m, recipeDoseG, doseG, cfg));
}

/* ------------------------------ roast level → grind nudge ------------------------------ */

/**
 * How Brew setup adjusts the grind for the bag's roast (a setting: More → Settings). Each roast
 * level has a shift (% of the method range, negative = finer): the data's `grindShift`
 * (catalog/coffee-vocab.json) unless `shifts` has your own. The grind moves by the bag's shift minus
 * the shift of the roast the recipe was written for — the recipe's own roast, else `baseline`.
 */
export interface RoastNudge { enabled: boolean; baseline: string; shifts: Record<string, number>; methods: Method[] }
/** Off by default: the data's shifts are a rule of thumb, not published numbers. */
export const DEFAULT_ROAST_NUDGE: RoastNudge = { enabled: false, baseline: "medium-light", shifts: {}, methods: [...METHODS] };
export interface RoastShiftLevel { id: string; label: string; grindShift?: number }

/** A roast level's shift: yours if set, else the data's. */
export const roastShift = (level: RoastShiftLevel, cfg: RoastNudge = DEFAULT_ROAST_NUDGE): number => cfg.shifts[level.id] ?? level.grindShift ?? 0;

/**
 * The roast part of the grind adjustment: % of the method range for a bag of roast `bag` brewed with
 * a recipe written for `recipe` (null = the baseline). Null when off, not this method, the bag has
 * no known roast level, or the two shifts are the same.
 */
export function roastPercent<L extends RoastShiftLevel>(
  m: Method, bag: L | null, recipe: L | null, levels: L[], cfg: RoastNudge = DEFAULT_ROAST_NUDGE,
): { percent: number; from: L; assumed: boolean } | null {
  if (!cfg.enabled || !cfg.methods.includes(m) || !bag) return null;
  const from = recipe ?? levels.find((l) => l.id === cfg.baseline) ?? null;
  if (!from) return null;
  const percent = roastShift(bag, cfg) - roastShift(from, cfg);
  return percent ? { percent, from, assumed: !recipe } : null;
}
