// "Estimate the empty rows": fills a grinder's missing grind ranges from its other ranges, using
// the rules in catalog/estimate-rules.json (data, not code). Used by the gear editor, and by the
// library check that the library's estimated rows follow the same rules.
import { METHODS, type GrindRange, type GrindRanges, type Method } from "./grind.js";

export interface EstimateRule { needs: Method[]; low: string; high: string; note: string }
export interface EstimateRules {
  version: number;
  notePrefix: string;
  noteSuffix: string;
  order: Method[];
  rules: Partial<Record<Method, EstimateRule[]>>;
}

/* ---------- a tiny, safe expression evaluator (no eval) ---------- */

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([a-z]+(?:\.[a-z]+)?)|([-+*/()]))/gy;
  let m: RegExpExecArray | null;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(i))) break;
      throw new Error(`can't read "${src.slice(i)}"`);
    }
    if (m[1]) out.push({ t: "num", v: Number(m[1]) });
    else if (m[2]) out.push({ t: "id", v: m[2] });
    else out.push({ t: "op", v: m[3] });
    i = re.lastIndex;
  }
  return out;
}

/** Evaluates `expr` with `get(name)` for identifiers (e.g. "pourover.low", "min"). */
export function evalExpr(expr: string, get: (name: string) => number): number {
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const factor = (): number => {
    const t = toks[p++];
    if (!t) throw new Error(`"${expr}" ends too soon`);
    if (t.t === "num") return t.v;
    if (t.t === "id") return get(t.v);
    if (t.v === "-") return -factor();
    if (t.v === "(") {
      const v = sum();
      if (toks[p++]?.v !== ")") throw new Error(`"${expr}" is missing a ")"`);
      return v;
    }
    throw new Error(`unexpected "${t.v}" in "${expr}"`);
  };
  const product = (): number => {
    let v = factor();
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) v = toks[p++].v === "*" ? v * factor() : v / factor();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) v = toks[p++].v === "+" ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (p !== toks.length) throw new Error(`unexpected "${toks[p].v}" in "${expr}"`);
  return v;
}

/* ---------- the estimator ---------- */

// Half-to-even, like the script the library's first estimates came from.
const roundHalfEven = (x: number) => {
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
};
const round3 = (x: number) => roundHalfEven(x * 1000) / 1000;

function roundForGrinder(v: number, gr: Pick<GrindRanges, "step" | "notation">): number {
  if (gr.notation === "thirds") return roundHalfEven(v * 2) / 2; // ranges are linear values; halves are fine
  if (gr.step && gr.step > 0) return round3(roundHalfEven(v / gr.step) * gr.step);
  return roundHalfEven(v * 100) / 100;
}

export interface EstimateResult {
  /** The new ranges, keyed by method. */
  methods: Partial<Record<Method, GrindRange>>;
  /** One sentence per estimated method, from the rule that made it. */
  notes: Partial<Record<Method, string>>;
  /** Methods asked for that couldn't be estimated: the ranges any one rule would need ([] = no rule). */
  missing: Partial<Record<Method, Method[][]>>;
}

/**
 * Estimates `targets` (methods with no range yet) from `gr`'s existing ranges. A target filled
 * earlier in `rules.order` can feed a later one. Doesn't change `gr`.
 */
export function estimateRanges(gr: GrindRanges, targets: Method[], rules: EstimateRules): EstimateResult {
  const have: Partial<Record<Method, GrindRange>> = { ...gr.methods };
  const out: EstimateResult = { methods: {}, notes: {}, missing: {} };
  const want = new Set(targets.filter((m) => !have[m] && !gr.unsupported?.includes(m)));
  const order = [...rules.order, ...METHODS.filter((m) => !rules.order.includes(m))];
  const get = (name: string) => {
    if (name === "min") return gr.min ?? 0;
    const [m, k] = name.split(".") as [Method, string];
    const r = have[m];
    if (!r) throw new Error(`no ${m} range`);
    if (k === "low") return r.low;
    if (k === "high") return r.high;
    if (k === "mid") return (r.low + r.high) / 2;
    if (k === "span") return r.high - r.low;
    throw new Error(`unknown "${name}"`);
  };
  const clamp = (v: number) => Math.min(gr.max ?? Infinity, Math.max(gr.min ?? -Infinity, v));
  for (const m of order) {
    if (!want.has(m)) continue;
    const alts = rules.rules[m] ?? [];
    const rule = alts.find((a) => a.needs.every((n) => have[n] && !gr.unsupported?.includes(n)));
    if (!rule) {
      out.missing[m] = alts.map((a) => a.needs);
      continue;
    }
    let low = clamp(roundForGrinder(evalExpr(rule.low, get), gr));
    let high = clamp(roundForGrinder(evalExpr(rule.high, get), gr));
    if (low > high) [low, high] = [high, low];
    have[m] = out.methods[m] = { low, high };
    out.notes[m] = rule.note;
  }
  return out;
}

/** The estimateNote for a set of estimated methods (in the app's method order). */
export function estimateNoteFor(notes: string[], rules: EstimateRules): string {
  return `${rules.notePrefix}${notes.join("; ")}${rules.noteSuffix}`;
}
