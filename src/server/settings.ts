// Per-instance preferences and first-run ("onboarding") state.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DB } from "./db.js";

import { METHODS, DEFAULT_DOSE_NUDGE } from "../shared/grind.js";
import { PREF_SECTIONS, PREF_LISTS, newTag, type Prefs, type PrefSection, type PrefTag } from "../shared/prefs.js";
import { loadTasteDefaults } from "./catalog.js";

const restWindow = z
  .object({ rest: z.number().int().min(0).max(365), peakEnd: z.number().int().min(1).max(730) })
  .refine((w) => w.rest < w.peakEnd, "The peak window has to end after the rest");

const PrefTagSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().trim().min(1, "A tag needs a name").max(80, "A tag can be at most 80 characters"),
  on: z.boolean(),
  words: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
});
const PrefListSchema = z.array(PrefTagSchema).max(150).refine((l) => new Set(l.map((t) => t.id)).size === l.length, "Two tags in one list have the same id");
const SectionSchema = z.object({ prefer: PrefListSchema, avoid: PrefListSchema, exclude: PrefListSchema });
export const SettingsSchema = z.object({
  tempUnit: z.enum(["C", "F"]),
  waterUnit: z.enum(["g", "oz"]),
  defaultRatio: z.number().min(1).max(30),
  discoverEnabled: z.boolean(),
  /**
   * Discover → Your taste: tags per section (roasters, processes, roasts, origins, notes) in three
   * lists — prefer / avoid (soft) and exclude ("Do not include", hard). Starts as
   * catalog/taste-defaults.json, all off.
   */
  prefs: z.object(Object.fromEntries(PREF_SECTIONS.map((s) => [s, SectionSchema])) as Record<PrefSection, typeof SectionSchema>),
  /** The drinker's own words about their taste — goes into the research prompt as written. */
  palateNotes: z.string().max(5000),
  /** Brew setup: move the grind when the dose differs from the recipe's. */
  doseNudge: z.object({
    enabled: z.boolean(),
    /** % of the grinder's range for the method, per doubling of the dose. */
    percent: z.number().min(0).max(100),
    methods: z.array(z.enum(METHODS)).max(METHODS.length),
  }),
  /** Check GitHub once a day for a newer release (off by default: it's a request to github.com). */
  updateCheck: z.boolean(),
  /** Prometheus metrics at GET /metrics (off by default). */
  metrics: z.boolean(),
  /** Stash: your own rest / peak window per roast level id (catalog/coffee-vocab.json has the defaults). */
  restWindows: z.record(z.string().regex(/^[a-z0-9-]{1,40}$/), restWindow),
  /** Backups: how many snapshots to keep (newest first). null = the BACKUP_KEEP default. */
  backupKeep: z.number().int().min(1).max(365).nullable(),
  /** "Do not include" suggestions the user said no to ("<section>:<tag id>"). */
  dismissedSuggestions: z.array(z.string().max(90)),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  tempUnit: "C", waterUnit: "g", defaultRatio: 16, discoverEnabled: true,
  prefs: loadTasteDefaults().prefs, palateNotes: "", dismissedSuggestions: [], updateCheck: false, metrics: false, backupKeep: null,
  restWindows: {},
  doseNudge: { ...DEFAULT_DOSE_NUDGE, methods: [...DEFAULT_DOSE_NUDGE.methods] },
};

export function getSettings(db: DB): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore a corrupt value — the default stands */
    }
  }
  const parsed = SettingsSchema.safeParse(out);
  if (parsed.success) return parsed.data;
  // One bad key shouldn't reset the rest: fall back key by key.
  const shape = SettingsSchema.shape as Record<string, z.ZodType>;
  const fixed: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) fixed[k] = shape[k].safeParse(out[k]).success ? out[k] : (DEFAULT_SETTINGS as any)[k];
  return fixed as Settings;
}


export function setSettings(db: DB, patch: unknown): Settings {
  const merged = { ...getSettings(db), ...(patch as object) };
  const s = SettingsSchema.parse(merged);
  const up = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  db.transaction(() => {
    for (const [k, v] of Object.entries(s)) up.run(k, JSON.stringify(v));
  })();
  return s;
}

export const isOnboarded = (db: DB) => (db.prepare("SELECT value FROM meta WHERE key='onboarded'").get() as { value: string } | undefined)?.value === "1";
export function setOnboarded(db: DB, on: boolean) {
  db.prepare("INSERT INTO meta (key, value) VALUES ('onboarded', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(on ? "1" : "0");
}

/** Installs that already have gear or data never see the first-run setup. */
export function markExistingInstallOnboarded(db: DB) {
  const has = db.prepare("SELECT value FROM meta WHERE key='onboarded'").get();
  if (has) return false;
  const n = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  if (n("gear_items") + n("recipes") + n("inventory_items") + n("brews") > 0) {
    setOnboarded(db, true);
    return true;
  }
  return false;
}

/**
 * One-time: an install's starting taste settings from its seed data (seed-data/taste.json:
 * palate notes and avoid rules), if it has any. Later edits in the app stick.
 */
export function applySeedTaste(db: DB, seedDir: string) {
  if (db.prepare("SELECT 1 FROM meta WHERE key='tasteSeeded'").get()) return false;
  let applied = false;
  const file = path.join(seedDir, "taste.json");
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const patch: Partial<Settings> = {};
    if (typeof j.palateNotes === "string") patch.palateNotes = j.palateNotes;
    // "avoidRules": ids of "Do not include" tags to switch on (the starter ids: cinnamon, decaf …).
    if (Array.isArray(j.avoidRules)) patch.prefs = switchOnExcludes(getSettings(db).prefs, j.avoidRules);
    setSettings(db, patch);
    applied = true;
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('tasteSeeded', ?)").run(new Date().toISOString());
  return applied;
}

/**
 * The old "always leave out" starter rules (also the ids seed taste.json uses) → the short
 * "Do not include" tags that now cover them. The first id is the rule's own.
 */
const OLD_RULES: Record<string, { section: PrefSection; tags: string[] }> = {
  cinnamon: { section: "notes", tags: ["cinnamon"] },
  coferment: { section: "processes", tags: ["coferment", "infused", "flavoured"] },
  funk: { section: "notes", tags: ["funk", "boozy", "winey", "barrel-aged", "solvent"] },
  decaf: { section: "processes", tags: ["decaf"] },
  "dark-roast": { section: "roasts", tags: ["dark-roast"] },
  blends: { section: "origins", tags: ["blends"] },
  robusta: { section: "origins", tags: ["robusta"] },
  smoky: { section: "notes", tags: ["smoky", "burnt"] },
};

/** Switch on "Do not include" tags by id (an old rule id switches on all of its tags). */
export function switchOnExcludes(prefs: Prefs, ids: string[]): Prefs {
  const p = structuredClone(prefs);
  const all = new Set(ids.flatMap((id) => OLD_RULES[id]?.tags ?? [id]));
  for (const s of PREF_SECTIONS) for (const t of p[s].exclude) if (all.has(t.id)) t.on = true;
  return p;
}

/**
 * One-time move from the old taste settings (always-leave-out rules, the quick quiz, roaster /
 * origin likes) to tag-based preferences. What was on stays on; rules you edited keep their words,
 * starter rules you deleted stay gone, your own rules become "Do not include" tags. Old keys are
 * left in the table (ignored) so an older version still finds them.
 */
export function migrateTastePrefs(db: DB): boolean {
  const rows = new Map((db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  if (rows.has("prefs") || !["ruleDefs", "avoidRules", "tasteQuiz", "tastePrefs"].some((k) => rows.has(k))) return false;
  const read = (k: string): any => {
    try {
      return rows.has(k) ? JSON.parse(rows.get(k)!) : undefined;
    } catch {
      return undefined;
    }
  };
  let p = structuredClone(loadTasteDefaults().prefs);
  const on = new Set<string>(Array.isArray(read("avoidRules")) ? read("avoidRules") : []);
  const defs: { id: string; label: string; keywords: string[] }[] | undefined = read("ruleDefs");
  if (Array.isArray(defs)) {
    for (const [id, g] of Object.entries(OLD_RULES)) {
      const d = defs.find((x) => x.id === id);
      if (!d) p[g.section].exclude = p[g.section].exclude.filter((t) => !g.tags.includes(t.id)); // deleted → gone
      else {
        // Words the user added to a starter rule join its first tag.
        const first = p[g.section].exclude.find((t) => t.id === g.tags[0]);
        const known = new Set(p[g.section].exclude.filter((t) => g.tags.includes(t.id)).flatMap((t) => t.words ?? [t.label]).map((w) => w.toLowerCase()));
        const extra = d.keywords.filter((w) => !known.has(w.toLowerCase()));
        if (first && extra.length) first.words = [...(first.words ?? [first.label]), ...extra];
      }
    }
    for (const d of defs)
      if (!(d.id in OLD_RULES) && !p.notes.exclude.some((t) => t.id === d.id)) p.notes.exclude.push({ id: d.id, label: d.label, on: false, words: d.keywords });
  }
  p = switchOnExcludes(p, [...on]);
  // Quiz answers and roaster / origin likes → matching tags switched on (or your own tags).
  const turnOn = (list: PrefTag[], labels: unknown) => {
    for (const l of Array.isArray(labels) ? labels : []) {
      if (typeof l !== "string" || !l.trim() || l === "Not sure") continue;
      const hit = list.find((t) => t.label.toLowerCase() === l.trim().toLowerCase());
      if (hit) hit.on = true;
      else list.push(newTag(l, list));
    }
  };
  const quiz = read("tasteQuiz") ?? {};
  turnOn(p.notes.prefer, quiz.loves);
  turnOn(p.notes.avoid, quiz.dislikes);
  turnOn(p.processes.prefer, quiz.processes);
  turnOn(p.roasts.prefer, quiz.roasts);
  const tp = read("tastePrefs") ?? {};
  turnOn(p.roasters.prefer, tp.roasters?.prefer);
  turnOn(p.roasters.avoid, tp.roasters?.avoid);
  turnOn(p.origins.prefer, tp.origins?.prefer);
  turnOn(p.origins.avoid, tp.origins?.avoid);
  const dismissed = (read("dismissedSuggestions") ?? []).map((id: string) => (OLD_RULES[id] ? `${OLD_RULES[id].section}:${id}` : id));
  setSettings(db, { prefs: p, dismissedSuggestions: dismissed });
  return true;
}

export { PREF_LISTS };
