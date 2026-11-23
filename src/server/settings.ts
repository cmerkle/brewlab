// Per-instance preferences and first-run ("onboarding") state.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DB } from "./db.js";

import { PRESET_RULES, type AvoidRuleDef } from "./rules.js";

const words = z.array(z.string().max(40)).max(30);
const RuleDef = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().trim().min(1, "Give the rule a name").max(80),
  keywords: z.array(z.string().trim().min(1).max(40)).min(1, "Add at least one word to look for").max(30),
});
export const SettingsSchema = z.object({
  tempUnit: z.enum(["C", "F"]),
  waterUnit: z.enum(["g", "oz"]),
  defaultRatio: z.number().min(1).max(30),
  discoverEnabled: z.boolean(),
  /** "Always leave out" rules: the user's list (starts as the presets; edit, delete, add). */
  ruleDefs: z.array(RuleDef).max(50),
  /** Ids of the rules that are switched on (off by default). */
  avoidRules: z.array(z.string().max(40)),
  /** The drinker's own words about their taste — goes into the research prompt as written. */
  palateNotes: z.string().max(5000),
  /** Optional quick quiz (first-run setup or Discover → Your taste). */
  tasteQuiz: z.object({ loves: words, dislikes: words, processes: words, roasts: words }),
  /** Avoid-rule suggestions the user said no to. */
  dismissedSuggestions: z.array(z.string().max(40)),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  tempUnit: "C", waterUnit: "g", defaultRatio: 16, discoverEnabled: true,
  ruleDefs: PRESET_RULES, avoidRules: [], palateNotes: "", tasteQuiz: { loves: [], dislikes: [], processes: [], roasts: [] }, dismissedSuggestions: [],
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

/** The rules that are switched on. */
export const enabledRules = (s: Settings): AvoidRuleDef[] => s.ruleDefs.filter((r) => s.avoidRules.includes(r.id));

export function setSettings(db: DB, patch: unknown): Settings {
  const merged = { ...getSettings(db), ...(patch as object) };
  const s = SettingsSchema.parse(merged);
  if (new Set(s.ruleDefs.map((r) => r.id)).size !== s.ruleDefs.length) throw new z.ZodError([{ code: "custom", message: "Two rules have the same id", path: ["ruleDefs"], input: s.ruleDefs }]);
  s.avoidRules = s.avoidRules.filter((id) => s.ruleDefs.some((r) => r.id === id)); // a deleted rule can't stay on
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
    if (Array.isArray(j.avoidRules)) patch.avoidRules = j.avoidRules;
    setSettings(db, patch);
    applied = true;
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('tasteSeeded', ?)").run(new Date().toISOString());
  return applied;
}
