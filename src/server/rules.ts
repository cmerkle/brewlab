// Weekly-refresh matching rules. Applied server-side before an edition is published.
import type { Candidate } from "./schemas.js";

export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(coffee|coffees|roasters?|roasting|co\.?|company)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Same coffee: names match (or one contains the other) and roasters match. */
export function sameCoffee(a: { name: string; roaster?: string | null }, b: { name: string; roaster?: string | null }) {
  const an = norm(a.name), bn = norm(b.name);
  const ar = norm(a.roaster), br = norm(b.roaster);
  if (!an || !bn) return false;
  const nameMatch = an === bn || (an.length >= 4 && bn.includes(an)) || (bn.length >= 4 && an.includes(bn));
  const roasterMatch = !ar || !br ? false : ar === br || ar.includes(br) || br.includes(ar);
  return nameMatch && roasterMatch;
}

// "Always leave out" — keyword exclusions for Discover. They're data, not code: the user's own
// list lives in settings.ruleDefs (starts as PRESET_RULES; edit, delete or add any), and
// settings.avoidRules holds the ids that are switched on. A candidate is left out when its name,
// process, tasting notes or notes contain one of a rule's words (start of a word, any case).
export interface AvoidRuleDef {
  id: string;
  label: string;
  keywords: string[];
}

export const PRESET_RULES: AvoidRuleDef[] = [
  { id: "cinnamon", label: "Cinnamon-forward coffees", keywords: ["cinnamon"] },
  { id: "coferment", label: "Co-ferments and flavoured / infused coffees", keywords: ["co-ferment", "coferment", "infused", "flavoured", "flavored"] },
  { id: "funk", label: "Intense fermentation funk (boozy, winey, barrel-aged)", keywords: ["funk", "boozy", "winey", "solvent", "overfermented", "fermenty", "rum barrel", "whiskey barrel", "whisky barrel", "barrel-aged", "barrel aged"] },
  { id: "decaf", label: "Decaf", keywords: ["decaf", "decaffeinated", "swiss water", "sugarcane process", "ea process"] },
  { id: "dark-roast", label: "Dark roasts", keywords: ["dark roast", "french roast", "italian roast", "vienna roast"] },
  { id: "blends", label: "Blends", keywords: ["blend"] },
  { id: "robusta", label: "Robusta and canephora", keywords: ["robusta", "canephora"] },
  { id: "smoky", label: "Smoky / roasty", keywords: ["smoky", "smokey", "smoke", "ashy", "burnt", "charred"] },
];

/** Lowercase, accents and punctuation → spaces, so "Co-Fermented" matches "co ferment". */
const fold = (s: string) => ` ${s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

export const ruleText = (c: { name?: string | null; processMethod?: string | null; tastingNotes?: string | null; notes?: string | null; roastLevel?: string | null }) =>
  `${c.name ?? ""} ${c.processMethod ?? ""} ${c.tastingNotes ?? ""} ${c.notes ?? ""} ${c.roastLevel ? `${c.roastLevel} roast` : ""}`;

/** The first of a rule's words found at the start of a word in the text, or null. */
export function ruleMatch(rule: AvoidRuleDef, text: string): string | null {
  const t = fold(text);
  for (const k of rule.keywords) {
    const kw = fold(k).trim();
    if (kw && t.includes(` ${kw}`)) return k;
  }
  return null;
}

/** Why a candidate breaks one of the enabled rules ("cinnamon-forward coffees: “cinnamon”"), or null. */
export function profileViolation(c: Pick<Candidate, "name" | "processMethod" | "tastingNotes" | "funkRisk"> & { roastLevel?: string | null }, rules: readonly AvoidRuleDef[] = PRESET_RULES.slice(0, 3)): string | null {
  const text = ruleText(c);
  for (const r of rules) {
    const hit = ruleMatch(r, text);
    if (hit) return `${r.label.toLowerCase()} (“${hit}”)`;
  }
  // The research step rates funk separately; the funk rule also honours it.
  const funk = rules.find((r) => r.id === "funk");
  if (funk && /^\s*(high|very high|extreme)/i.test(c.funkRisk ?? "")) return `${funk.label.toLowerCase()} (high funk risk)`;
  return null;
}

export interface RuleContext {
  tastings: { name: string; roaster: string | null }[];
  avoids: { name: string; roaster: string | null }[];
  stash: { name: string; roaster: string | null; status: string }[];
  /** Enabled "always leave out" rules; omitted = the original three presets. */
  rules?: readonly AvoidRuleDef[];
}

export interface Dropped {
  candidate: Candidate;
  reason: string;
}

export function applyMatchingRules(cands: Candidate[], ctx: RuleContext): { kept: Candidate[]; dropped: Dropped[] } {
  const kept: Candidate[] = [];
  const dropped: Dropped[] = [];
  for (const c of cands) {
    let reason: string | null = null;
    if (ctx.tastings.some((t) => sameCoffee(c, t))) reason = "already in the tasting log";
    else if (ctx.avoids.some((a) => sameCoffee(c, a))) reason = "on the avoid list";
    else {
      const v = profileViolation(c, ctx.rules);
      if (v) reason = `profile: ${v}`;
      else if (ctx.stash.some((s) => s.status !== "finished" && sameCoffee(c, s))) reason = "already in the stash";
      else if (kept.some((k) => sameCoffee(c, k))) reason = "duplicate candidate";
    }
    if (reason) dropped.push({ candidate: c, reason });
    else kept.push(c);
  }
  return { kept, dropped };
}
