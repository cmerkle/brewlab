// Weekly-refresh matching rules. Applied server-side before an edition is published.
import type { Candidate } from "./schemas.js";
import { matchList, activeTags, SECTION_LABELS, type Prefs } from "../shared/prefs.js";

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

// "Do not include" — the hard filter for Discover: switched-on tags in the exclude lists of
// settings.prefs (src/shared/prefs.ts). Each section looks at its own fields of a coffee.

/** Why a candidate is left out by a "Do not include" tag ("tasting notes: cinnamon-forward coffees (“cinnamon”)"), or null. */
export function profileViolation(c: Pick<Candidate, "name" | "processMethod" | "tastingNotes" | "funkRisk"> & { roaster?: string | null; origin?: string | null; roastLevel?: string | null }, prefs?: Prefs): string | null {
  if (!prefs) return null;
  const hit = matchList(c, prefs, "exclude");
  if (hit) return `${SECTION_LABELS[hit.section].toLowerCase()}: ${hit.tag.label.toLowerCase()} (“${hit.word}”)`;
  // The research step rates funk separately; the fermentation-funk tag also honours it.
  const funk = activeTags(prefs, "exclude").find((x) => x.tag.id === "funk");
  if (funk && /^\s*(high|very high|extreme)/i.test(c.funkRisk ?? "")) return `${SECTION_LABELS[funk.section].toLowerCase()}: ${funk.tag.label.toLowerCase()} (high funk risk)`;
  return null;
}

export interface RuleContext {
  tastings: { name: string; roaster: string | null }[];
  avoids: { name: string; roaster: string | null }[];
  stash: { name: string; roaster: string | null; status: string }[];
  /** Your preferences; their switched-on "Do not include" tags leave candidates out. */
  prefs?: Prefs;
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
      const v = profileViolation(c, ctx.prefs);
      if (v) reason = `profile: ${v}`;
      else if (ctx.stash.some((s) => s.status !== "finished" && sameCoffee(c, s))) reason = "already in the stash";
      else if (kept.some((k) => sameCoffee(c, k))) reason = "duplicate candidate";
    }
    if (reason) dropped.push({ candidate: c, reason });
    else kept.push(c);
  }
  return { kept, dropped };
}
