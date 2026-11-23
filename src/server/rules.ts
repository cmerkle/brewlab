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

// Keyword exclusions — per-user toggles in Discover → Your taste (settings.avoidRules).
export const AVOID_RULES = [
  { id: "cinnamon", label: "Cinnamon-forward coffees", re: /cinnamon/, reason: "cinnamon-forward" },
  { id: "coferment", label: "Co-ferments and flavoured / infused coffees", re: /co-?ferment|coferment|fruit[- ]infused|infused|flavou?red/, reason: "co-ferment-led / infused" },
  { id: "funk", label: "Intense fermentation funk (boozy, winey, barrel-aged)", re: /\bfunk(y)?\b|boozy|winey|solvent|overfermented|fermenty|rum[- ]barrel|whiskey[- ]barrel|barrel[- ]aged/, reason: "intense fermentation funk" },
] as const;
export type AvoidRuleId = (typeof AVOID_RULES)[number]["id"];
const ALL_RULES = AVOID_RULES.map((r) => r.id) as AvoidRuleId[];

export const ruleText = (c: { name?: string | null; processMethod?: string | null; tastingNotes?: string | null; notes?: string | null }) =>
  `${c.name ?? ""} ${c.processMethod ?? ""} ${c.tastingNotes ?? ""} ${c.notes ?? ""}`.toLowerCase();

export function profileViolation(c: Pick<Candidate, "name" | "processMethod" | "tastingNotes" | "funkRisk">, rules: readonly AvoidRuleId[] = ALL_RULES): string | null {
  const text = ruleText(c);
  for (const r of AVOID_RULES) if (rules.includes(r.id) && r.re.test(text)) return r.reason;
  if (rules.includes("funk") && /^\s*(high|very high|extreme)/i.test(c.funkRisk ?? "")) return "intense fermentation funk (high funk risk)";
  return null;
}

export interface RuleContext {
  tastings: { name: string; roaster: string | null }[];
  avoids: { name: string; roaster: string | null }[];
  stash: { name: string; roaster: string | null; status: string }[];
  /** Enabled keyword exclusions; omitted = all. */
  rules?: readonly AvoidRuleId[];
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
