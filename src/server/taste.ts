// Taste summary: what the drinker's own data says they like. Built fresh on every refresh from
//   finished-bag verdicts / Stash star ratings, average brew rating per coffee, and the tasting log.
// It drives the research prompt (how personal to be) and, without an AI provider, the ranking
// of entered candidates. Nothing here is guessed: every line cites the ratings behind it.
import type { DB } from "./db.js";
import type { Candidate } from "./schemas.js";
import { sameCoffee } from "./rules.js";
import { getSettings, type Settings } from "./settings.js";
import { PREF_SECTIONS, SECTION_LABELS, activeTags, matchList, tagHit, sectionText, type PrefList, type PrefSection, type Prefs } from "../shared/prefs.js";
import { parseTags } from "./bags.js";

const VERDICT_SCORE: Record<string, number> = { loved: 5, liked: 4, not_for_me: 2, disliked: 1 };

const ORIGINS: [string, RegExp][] = [
  ["Ethiopia", /ethiopia|yirg|guji|sidam|sidama|limu|harrar|harar/], ["Kenya", /kenya|nyeri|kirinyaga/], ["Colombia", /colombia|huila|nari[nñ]o|cauca|tolima/],
  ["Brazil", /brazil|cerrado|mogiana/], ["Guatemala", /guatemala|huehuetenango|antigua/], ["Costa Rica", /costa rica|tarraz[uú]|west valley/],
  ["Panama", /panama|boquete/], ["Honduras", /honduras/], ["El Salvador", /el salvador/], ["Nicaragua", /nicaragua/], ["Peru", /\bperu\b/],
  ["Bolivia", /bolivia/], ["Ecuador", /ecuador/], ["Mexico", /mexico|chiapas|oaxaca/], ["Rwanda", /rwanda/], ["Burundi", /burundi/],
  ["Uganda", /uganda/], ["Tanzania", /tanzania/], ["Congo", /congo|\bdrc\b|kivu/], ["Yemen", /yemen/], ["Indonesia", /indonesia|sumatra|java|sulawesi|flores|bali/],
  ["Papua New Guinea", /papua|png\b/], ["India", /\bindia\b/], ["China", /china|yunnan/], ["Hawaii", /hawai|kona/],
];
const PROCESSES: [string, RegExp][] = [
  ["anaerobic / experimental", /anaerobic|carbonic|thermal shock|extended ferment|double ferment|co-?ferment|infused|yeast/],
  ["natural", /natural|dry[- ]process|sun[- ]dried/], ["honey", /honey|pulped natural/], ["wet-hulled", /wet[- ]hulled|giling/],
  ["washed", /washed|wet[- ]process|fully washed/], ["decaf", /decaf/],
];
const ROASTS: [string, RegExp][] = [["light", /\blight\b|nordic/], ["medium", /\bmedium\b/], ["dark", /\bdark\b|french roast|espresso roast/]];
const NOTES: [string, RegExp][] = [
  ["berry", /berry|berries|blackcurrant|cassis/], ["citrus", /citrus|lemon|lime|orange|grapefruit|bergamot|mandarin/],
  ["stone fruit", /peach|apricot|nectarine|plum|cherry/], ["tropical", /tropical|mango|pineapple|papaya|passion ?fruit|lychee/],
  ["floral", /floral|jasmine|rose|lavender|hibiscus|blossom/], ["tea-like", /\btea\b|black tea|earl grey/],
  ["chocolate", /chocolate|cocoa|cacao/], ["caramel & sweet", /caramel|toffee|brown sugar|honey|maple|molasses|panela|butterscotch/],
  ["nutty", /\bnut(s|ty)?\b|almond|hazelnut|pecan|walnut/], ["spice", /spice|cinnamon|clove|nutmeg|cardamom/],
  ["winey / boozy", /wine|winey|boozy|\brum\b|whiskey|liqueur/], ["earthy", /earthy|tobacco|cedar|smoky|savory|savoury/],
];

type Feature = { kind: "origin" | "process" | "roast" | "note"; name: string };
const match = (text: string, list: [string, RegExp][], kind: Feature["kind"], first = false): Feature[] => {
  const out: Feature[] = [];
  for (const [name, re] of list) if (re.test(text)) { out.push({ kind, name }); if (first) break; }
  return out;
};
export function featuresOf(c: { name?: string | null; origin?: string | null; processMethod?: string | null; roastLevel?: string | null; tastingNotes?: string | null; notes?: string | null }): Feature[] {
  const where = `${c.origin ?? ""} ${c.name ?? ""}`.toLowerCase();
  const proc = `${c.processMethod ?? ""} ${c.name ?? ""}`.toLowerCase();
  return [
    ...match(where, ORIGINS, "origin", true),
    ...match(proc, PROCESSES, "process", true),
    ...match((c.roastLevel ?? "").toLowerCase(), ROASTS, "roast", true),
    ...match(`${c.tastingNotes ?? ""} ${c.notes ?? ""}`.toLowerCase(), NOTES, "note"),
  ];
}

export interface RatedCoffee {
  name: string; roaster: string | null; origin: string | null; processMethod: string | null; roastLevel: string | null;
  notes: string | null; score: number; sources: string[];
}

/** Every coffee the user has rated, merged across Stash, brews and tastings (score 1–5). */
export function ratedCoffees(db: DB): RatedCoffee[] {
  const out: (RatedCoffee & { parts: number[] })[] = [];
  const add = (c: Omit<RatedCoffee, "score" | "sources">, score: number, source: string) => {
    const hit = out.find((x) => sameCoffee(x, c) || (!x.roaster && !c.roaster && x.name.toLowerCase() === c.name.toLowerCase()));
    if (hit) {
      hit.parts.push(score);
      hit.sources.push(source);
      for (const k of ["origin", "processMethod", "roastLevel"] as const) hit[k] = hit[k] ?? c[k];
      hit.notes = [hit.notes, c.notes].filter(Boolean).join(" · ") || null;
    } else out.push({ ...c, parts: [score], sources: [source], score: 0 });
  };
  // A bag's tasting-note tags count as its notes (that's how they shape the taste summary).
  const bags = (db.prepare("SELECT id, name, roaster, origin, processMethod, roastLevel, notes, tastingNotes, rating FROM inventory_items").all() as any[]).map(
    ({ tastingNotes, ...b }) => ({ ...b, notes: [b.notes, parseTags(tastingNotes).join(", ")].filter(Boolean).join(" · ") || null }),
  );
  for (const b of bags) if (b.rating) add(b, b.rating, `Stash ${b.rating}★`);
  const brews = db.prepare("SELECT inventoryId, coffee, AVG(rating) avg, COUNT(*) n FROM brews WHERE rating IS NOT NULL GROUP BY inventoryId, coffee").all() as any[];
  for (const r of brews) {
    const bag = r.inventoryId ? bags.find((b) => b.id === r.inventoryId) : null;
    const base = bag ?? { name: r.coffee, roaster: null, origin: null, processMethod: null, roastLevel: null, notes: null };
    if (!base.name) continue;
    add(base, Math.round(r.avg * 10) / 10, `${r.n} brew${r.n === 1 ? "" : "s"} avg ${Math.round(r.avg * 10) / 10}★`);
  }
  for (const t of db.prepare("SELECT name, roaster, origin, processMethod, verdict, notes FROM tastings").all() as any[]) {
    const s = VERDICT_SCORE[t.verdict];
    if (s) add({ ...t, roastLevel: null }, s, `tasting: ${t.verdict.replace(/_/g, " ")}`);
  }
  return out.map(({ parts, ...c }) => ({ ...c, score: Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10 }));
}

export interface Affinity { kind: Feature["kind"]; name: string; n: number; avg: number; coffees: string[] }
export type Stage = "popular" | "mixed" | "tailored";

export interface TasteSummary {
  rated: number;
  stage: Stage;
  likes: Affinity[];
  dislikes: Affinity[];
  coffees: RatedCoffee[];
}

const label = (a: Affinity) => (a.kind === "origin" ? a.name : a.kind === "process" ? `${a.name} process` : a.kind === "roast" ? `${a.name} roast` : `${a.name} notes`);
export const describe = (a: Affinity) => `${label(a)}: ${a.n} coffee${a.n === 1 ? "" : "s"}, avg ${a.avg}★`;

export function tasteSummary(db: DB): TasteSummary {
  const coffees = ratedCoffees(db);
  const by = new Map<string, Affinity & { sum: number }>();
  for (const c of coffees)
    for (const f of featuresOf(c)) {
      const k = `${f.kind}:${f.name}`;
      const a = by.get(k) ?? { ...f, n: 0, avg: 0, sum: 0, coffees: [] };
      a.n++;
      a.sum += c.score;
      a.coffees.push(c.name);
      by.set(k, a);
    }
  const all = [...by.values()].map(({ sum, ...a }) => ({ ...a, avg: Math.round((sum / a.n) * 10) / 10 }));
  const rank = (a: Affinity) => (a.avg - 3) * Math.min(a.n, 3);
  return {
    rated: coffees.length,
    stage: coffees.length === 0 ? "popular" : coffees.length < 5 ? "mixed" : "tailored",
    likes: all.filter((a) => a.avg >= 4).sort((a, b) => rank(b) - rank(a)).slice(0, 8),
    dislikes: all.filter((a) => a.avg <= 2.5).sort((a, b) => rank(a) - rank(b)).slice(0, 6),
    coffees,
  };
}


/** The "about this drinker" block of the research prompt. */
export function tasteProfileText(s: TasteSummary, settings: Settings): string {
  const lines: string[] = [];
  if (s.stage === "popular")
    lines.push(
      "This drinker has NO ratings yet. Recommend generic, widely loved, approachable current offerings across a spread of styles",
      "(for example a clean washed Central or South American, a fruity natural or washed Ethiopian, a sweet chocolatey Brazil or blend,",
      "a bright washed Kenyan, a honey-process coffee). Favour well-regarded roasters with reliable availability. Picks are a starting point to rate.",
    );
  else if (s.stage === "mixed")
    lines.push(
      `This drinker has rated ${s.rated} coffee${s.rated === 1 ? "" : "s"} — not enough to be sure. Make about half the picks popular, approachable`,
      "coffees, and half explore around what they rated well. Deliberately include at least one style they haven't rated yet, to learn more.",
    );
  else lines.push(`This drinker has rated ${s.rated} coffees. Tailor the picks to the taste summary below, plus one wildcard that stretches the palate.`);
  if (s.likes.length) lines.push("", "Rated well (from their own ratings):", ...s.likes.map((a) => `- ${describe(a)}`));
  if (s.dislikes.length) lines.push("", "Rated poorly (from their own ratings):", ...s.dislikes.map((a) => `- ${describe(a)}`));
  if (s.coffees.length)
    lines.push("", "Rated coffees:", ...s.coffees.slice(0, 25).map((c) => `- ${c.name}${c.roaster ? ` (${c.roaster})` : ""}: ${c.score}★ [${c.sources.join(", ")}]`));
  // Preferences: switched-on tags, by list and section.
  const listLines = (list: PrefList) =>
    PREF_SECTIONS.map((sec) => [sec, settings.prefs[sec][list].filter((t) => t.on).map((t) => t.label)] as const)
      .filter(([, l]) => l.length)
      .map(([sec, l]) => `- ${SECTION_LABELS[sec]}: ${l.join(", ")}`);
  const prefer = listLines("prefer");
  const avoid = listLines("avoid");
  if (prefer.length) lines.push("", "They prefer (favour these):", ...prefer);
  if (avoid.length) lines.push("", "They'd rather avoid (steer away, but not a hard rule):", ...avoid);
  if (settings.palateNotes.trim()) lines.push("", "In their own words:", settings.palateNotes.trim());
  const never = activeTags(settings.prefs, "exclude");
  if (never.length)
    lines.push("", "Never pick (their “do not include” tags — any of these words):",
      ...never.map(({ section, tag }) => `- ${SECTION_LABELS[section]}: ${tag.label}${tag.words?.length ? ` (${tag.words.join(", ")})` : ""}`));
  lines.push(
    "",
    "In whyFit, when a pick relates to their ratings, say so concretely using the numbers above (e.g. \"you rated two natural Ethiopians 5★\").",
    "Never invent ratings they haven't given. For popular picks, say plainly that it's a widely loved starting point.",
  );
  return lines.join("\n");
}

/** Without an AI provider: score an entered candidate against the summary and your preferences, with a reason. */
export function scoreCandidate(c: Candidate, s: TasteSummary, prefs?: Prefs): { score: number; reason: string | null } {
  const feats = featuresOf(c);
  const hits = [...s.likes, ...s.dislikes].filter((a) => feats.some((f) => f.kind === a.kind && f.name === a.name));
  let score = hits.reduce((t, a) => t + (a.avg - 3) * Math.min(a.n, 3), 0);
  const p = prefs ? matchList(c, prefs, "prefer") : null;
  const v = prefs ? matchList(c, prefs, "avoid") : null;
  const pref = p ? `Matches your preferred ${SECTION_LABELS[p.section].toLowerCase()}: ${p.tag.label}.` : null;
  const avoid = v ? `Heads-up: on your rather-avoid list (${SECTION_LABELS[v.section].toLowerCase()}: ${v.tag.label}).` : null;
  if (pref) score += 3;
  if (avoid) score -= 3;
  if (avoid) return { score, reason: avoid };
  const best = hits.filter((a) => a.avg >= 4).sort((a, b) => b.avg * b.n - a.avg * a.n)[0];
  const worst = hits.filter((a) => a.avg <= 2.5)[0];
  const rated = best
    ? `You rated ${best.n === 1 ? "a" : best.n} ${label(best)} coffee${best.n === 1 ? "" : "s"} ${best.avg}★ on average.`
    : worst
      ? `Heads-up: you rated ${label(worst)} coffees ${worst.avg}★ on average.`
      : null;
  return { score, reason: [pref, rated].filter(Boolean).join(" ") || null };
}

export interface Suggestion { id: string; section: PrefSection; tagId: string; text: string; coffees: string[] }

/** "Leave out cinnamon-forward coffees? You rated 2 of them ≤2★" — offered, never switched on silently. */
export function avoidSuggestions(db: DB, s: TasteSummary = tasteSummary(db), settings = getSettings(db)): Suggestion[] {
  const out: Suggestion[] = [];
  for (const section of PREF_SECTIONS)
    for (const t of settings.prefs[section].exclude) {
      const id = `${section}:${t.id}`;
      if (t.on || settings.dismissedSuggestions.includes(id)) continue;
      const low = s.coffees.filter((c) => c.score <= 2 && tagHit(t, sectionText(c, section)));
      if (low.length >= 2)
        out.push({ id, section, tagId: t.id, coffees: low.map((c) => c.name), text: `Leave out ${t.label.toLowerCase()}? You rated ${low.length} of them 2★ or lower (${low.map((c) => c.name).join(", ")}).` });
    }
  return out;
}
