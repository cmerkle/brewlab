// Discover → Your taste: tag-based preferences. Five sections, each with three lists:
//   prefer  — favoured in the research and the ranking (soft)
//   avoid   — steered away from (soft)
//   exclude — "Do not include": a coffee that matches is left out of the board (hard)
// Every tag can be switched on or off and removed. Built-in tags (catalog/taste-defaults.json)
// start off. A tag matches when one of its words starts a word in the section's fields.

export const PREF_SECTIONS = ["roasters", "processes", "roasts", "origins", "notes"] as const;
export type PrefSection = (typeof PREF_SECTIONS)[number];
export const PREF_LISTS = ["prefer", "avoid", "exclude"] as const;
export type PrefList = (typeof PREF_LISTS)[number];

export const SECTION_LABELS: Record<PrefSection, string> = { roasters: "Roasters", processes: "Processes", roasts: "Roast level", origins: "Origins", notes: "Tasting notes" };
export const LIST_LABELS: Record<PrefList, string> = { prefer: "Preferred", avoid: "Rather avoid", exclude: "Do not include" };

export interface PrefTag { id: string; label: string; on: boolean; words?: string[] }
export type Prefs = Record<PrefSection, Record<PrefList, PrefTag[]>>;

export const emptyPrefs = (): Prefs =>
  Object.fromEntries(PREF_SECTIONS.map((s) => [s, { prefer: [], avoid: [], exclude: [] }])) as unknown as Prefs;

export const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tag";

/** Lowercase, accents and punctuation → spaces, padded, so matching is "starts a word". */
const pad = (s: string) => ` ${s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

export interface CoffeeLike {
  name?: string | null; roaster?: string | null; origin?: string | null; processMethod?: string | null;
  roastLevel?: string | null; tastingNotes?: string | null; notes?: string | null;
}

/** What each section looks at in a coffee. */
export function sectionText(c: CoffeeLike, s: PrefSection): string {
  switch (s) {
    case "roasters": return `${c.roaster ?? ""}`;
    case "origins": return `${c.origin ?? ""} ${c.name ?? ""}`;
    case "processes": return `${c.processMethod ?? ""} ${c.name ?? ""} ${c.tastingNotes ?? ""} ${c.notes ?? ""}`;
    case "roasts": return `${c.roastLevel ? `${c.roastLevel} roast` : ""} ${c.name ?? ""} ${c.notes ?? ""}`;
    // Process too: infusions are often described there ("cinnamon co-ferment").
    case "notes": return `${c.tastingNotes ?? ""} ${c.notes ?? ""} ${c.name ?? ""} ${c.processMethod ?? ""}`;
  }
}

/** "Peaberries" → "peaberry", "Blends" → "blend": your own tag also matches the singular. */
const singular = (s: string) => s.replace(/ies$/i, "y").replace(/(ch|sh|x|ss)es$/i, "$1").replace(/([^s])s$/i, "$1");

/** The word of a tag found in the text (start of a word, any case), or null. */
export function tagHit(tag: Pick<PrefTag, "label" | "words">, text: string): string | null {
  const t = pad(text);
  for (const w of tag.words?.length ? tag.words : [tag.label, singular(tag.label)]) {
    const k = pad(w).trim();
    if (k && t.includes(` ${k}`)) return w;
  }
  return null;
}

/** Matching order: the most specific reason first (tasting notes, then process …); the page shows PREF_SECTIONS order. */
const MATCH_ORDER: PrefSection[] = ["notes", "processes", "roasts", "origins", "roasters"];

/** Switched-on tags of one list across all sections, with their section. */
export const activeTags = (p: Prefs, list: PrefList) => MATCH_ORDER.flatMap((s) => p[s][list].filter((t) => t.on).map((tag) => ({ section: s, tag })));

/** The first switched-on tag of a list that matches the coffee. */
export function matchList(c: CoffeeLike, p: Prefs, list: PrefList): { section: PrefSection; tag: PrefTag; word: string } | null {
  for (const { section, tag } of activeTags(p, list)) {
    const word = tagHit(tag, sectionText(c, section));
    if (word) return { section, tag, word };
  }
  return null;
}

/** A new tag for a list: its id is unique in that list. */
export function newTag(label: string, list: PrefTag[]): PrefTag {
  const base = slug(label);
  let id = base;
  for (let n = 2; list.some((t) => t.id === id); n++) id = `${base}-${n}`;
  return { id, label: label.trim(), on: true };
}
