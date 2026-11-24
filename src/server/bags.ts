// Bag words: roast level to the vocabulary's label, tasting notes as tags.
import type { DB } from "./db.js";
import { loadVocab } from "./catalog.js";
import { roastLevelOf, splitTags } from "../shared/stash.js";

/** "light-medium" → "Medium-light"; text that isn't a known level is kept as written. */
export function normalizeRoastLevel(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  return roastLevelOf(t, loadVocab().vocab.roastLevels)?.label ?? t;
}

export const parseTags = (v: unknown): string[] => {
  try {
    const x = JSON.parse(String(v ?? "[]"));
    return Array.isArray(x) ? x.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
};

/** Clean, lower-case, de-duplicated tags. */
export const cleanTags = (tags: string[] | null | undefined) => [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 40);

/**
 * One-time tidy for bags saved before tags existed: roast levels to the vocabulary's labels, and a
 * "Tasting notes: a, b" part of the notes (added by imports and Discover) moved into tags.
 */
export function tidyBags(db: DB): { roast: number; tags: number } {
  let roast = 0, tags = 0;
  const up = db.prepare("UPDATE inventory_items SET roastLevel=?, notes=?, tastingNotes=? WHERE id=?");
  db.transaction(() => {
    for (const b of db.prepare("SELECT id, roastLevel, notes, tastingNotes FROM inventory_items").all() as any[]) {
      const rl = normalizeRoastLevel(b.roastLevel);
      let notes = b.notes as string | null;
      let t = parseTags(b.tastingNotes);
      if (!t.length && notes && /tasting notes:/i.test(notes)) {
        const parts = notes.split(" · ");
        const hit = parts.find((p) => /^\s*tasting notes:/i.test(p));
        if (hit) {
          t = splitTags(hit.replace(/^\s*tasting notes:/i, ""));
          notes = parts.filter((p) => p !== hit).join(" · ") || null;
          if (t.length) tags++;
        }
      }
      if (rl !== b.roastLevel) roast++;
      if (rl !== b.roastLevel || notes !== b.notes || JSON.stringify(t) !== JSON.stringify(parseTags(b.tastingNotes))) up.run(rl, notes, JSON.stringify(t), b.id);
    }
  })();
  return { roast, tags };
}
