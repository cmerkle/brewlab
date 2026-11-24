import express, { type Response } from "express";
import { type DB, nowIso } from "./db.js";
import { TastingSchema, AvoidSchema, CandidateSchema, type Candidate, firstError } from "./schemas.js";
import { addToInventory } from "./routes-brew.js";
import { applyMatchingRules, type Dropped } from "./rules.js";
import { llmConfig, researchSupported, researchCandidates } from "./llm.js";
import { getSettings, setSettings } from "./settings.js";
import { PREF_SECTIONS } from "../shared/prefs.js";
import { loadTasteDefaults } from "./catalog.js";
import { tasteSummary, tasteProfileText, scoreCandidate, avoidSuggestions, describe } from "./taste.js";

const PICK_STATUSES = ["new", "saved", "passed", "tried"] as const;

export function weekLabelFor(d = new Date()) {
  // Monday of the current week, local time.
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return `Week of ${x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function setRefresh(db: DB, status: string, note: string) {
  db.prepare("UPDATE refresh_state SET lastRunAt=?, lastStatus=?, lastNote=? WHERE id=1").run(nowIso(), status, note);
}

function ruleContext(db: DB) {
  return {
    prefs: getSettings(db).prefs,
    tastings: db.prepare("SELECT name, roaster FROM tastings").all() as any[],
    avoids: db.prepare("SELECT name, roaster FROM avoids").all() as any[],
    stash: (db.prepare("SELECT name, roaster, finishedDate, openedDate FROM inventory_items").all() as any[]).map((i) => ({
      ...i,
      status: i.finishedDate ? "finished" : i.openedDate ? "open" : "unopened",
    })),
  };
}

export interface RefreshResult {
  status: "published" | "nothing_to_publish" | "error";
  note: string;
  editionId?: number;
  kept: Candidate[];
  dropped: Dropped[];
}

/** Apply the matching rules and publish an edition. Ranks: picks first (in given order), wildcard last. */
export function publishEdition(db: DB, cands: Candidate[], weekLabel: string, seasonNote: string | null, source: string, opts: { rankByTaste?: boolean } = {}): RefreshResult {
  let { kept, dropped } = applyMatchingRules(cands, ruleContext(db));
  // Entered candidates (no AI research) are ranked by the taste summary, each with its reason.
  if (opts.rankByTaste) {
    const s = tasteSummary(db);
    const prefs = getSettings(db).prefs;
    const anyPrefs = PREF_SECTIONS.some((sec) => prefs[sec].prefer.some((t) => t.on) || prefs[sec].avoid.some((t) => t.on));
    if (s.stage !== "popular" || anyPrefs) {
      const scored = kept.map((c, i) => ({ c, i, ...scoreCandidate(c, s, prefs) }));
      scored.sort((a, b) => (a.c.kind === "wildcard" ? 1 : 0) - (b.c.kind === "wildcard" ? 1 : 0) || b.score - a.score || a.i - b.i);
      kept = scored.map(({ c, reason }) => (reason && !(c.whyFit ?? "").includes(reason) ? { ...c, whyFit: [c.whyFit, reason].filter(Boolean).join(" ") } : c));
    }
  }
  if (kept.length === 0) {
    const note = `${source}: all ${cands.length} candidate${cands.length === 1 ? " was" : "s were"} dropped by the matching rules — nothing published.`;
    setRefresh(db, "nothing_to_publish", note);
    return { status: "nothing_to_publish", note, kept, dropped };
  }
  // 2–3 ranked picks + one wildcard is the target shape; keep at most 6 total.
  const picks = kept.filter((c) => c.kind !== "wildcard");
  const wild = kept.filter((c) => c.kind === "wildcard");
  const ordered = [...picks.slice(0, wild.length ? 5 : 6), ...wild.slice(0, 1)];
  const editionId = db.transaction(() => {
    const e = db.prepare("INSERT INTO board_editions (weekLabel, seasonNote, createdAt) VALUES (?, ?, ?)").run(weekLabel, seasonNote, nowIso());
    ordered.forEach((c, i) => {
      db.prepare(
        `INSERT INTO picks (editionId, rank, kind, name, roaster, origin, processMethod, tastingNotes, roastLevel, priceAmount, priceText, url, whyFit, brewTip, funkRisk, status, inventoryState)
         VALUES (@editionId, @rank, @kind, @name, @roaster, @origin, @processMethod, @tastingNotes, @roastLevel, @priceAmount, @priceText, @url, @whyFit, @brewTip, @funkRisk, 'new', 'not_added')`,
      ).run({
        editionId: e.lastInsertRowid, rank: i + 1, kind: c.kind ?? "pick", name: c.name, roaster: c.roaster, origin: c.origin ?? null,
        processMethod: c.processMethod ?? null, tastingNotes: c.tastingNotes ?? null, roastLevel: c.roastLevel ?? null,
        priceAmount: c.priceAmount ?? null, priceText: c.priceText ?? null, url: c.url ?? null, whyFit: c.whyFit ?? null,
        brewTip: c.brewTip ?? null, funkRisk: c.funkRisk ?? null,
      });
    });
    return Number(e.lastInsertRowid);
  })();
  const extra = kept.length - ordered.length;
  const note =
    `${source}: published ${ordered.length} pick${ordered.length === 1 ? "" : "s"}` +
    (dropped.length ? `; dropped ${dropped.length} (${dropped.map((d) => `${d.candidate.name} — ${d.reason}`).join("; ")})` : "") +
    (extra > 0 ? `; ${extra} more passed the rules but didn't fit the board` : "") +
    (ordered.length < 4 ? ". Fewer than 4 picks this week." : ".");
  setRefresh(db, "published", note);
  return { status: "published", note, editionId, kept: ordered, dropped };
}

/** The weekly refresh job (cron or manual). */
export async function runRefresh(db: DB, opts: { candidates?: Candidate[]; trigger: "manual" | "schedule" }): Promise<RefreshResult> {
  const weekLabel = weekLabelFor();
  try {
    let cands = opts.candidates;
    let seasonNote: string | null = null;
    let source = opts.trigger === "schedule" ? "Scheduled refresh" : "Manual refresh";
    let fromQueue = false;
    if (!cands || cands.length === 0) {
      const queued = (db.prepare("SELECT * FROM refresh_candidates ORDER BY id").all() as any[]).map((r) => JSON.parse(r.data));
      if (queued.length) {
        cands = queued;
        fromQueue = true;
        source += " (entered candidates)";
      }
    }
    if ((!cands || cands.length === 0) && researchSupported()) {
      const latest = db.prepare("SELECT id FROM board_editions ORDER BY createdAt DESC, id DESC LIMIT 1").get() as any;
      const prev = latest ? (db.prepare("SELECT name, roaster FROM picks WHERE editionId=?").all(latest.id) as any[]) : [];
      const ctx = ruleContext(db);
      const fmt = (x: any) => `${x.name} (${x.roaster ?? "?"})`;
      const out = await researchCandidates({
        weekLabel,
        palate: tasteProfileText(tasteSummary(db), getSettings(db)),
        tried: ctx.tastings.map(fmt),
        avoid: ctx.avoids.map(fmt),
        stash: ctx.stash.filter((s) => s.status !== "finished").map(fmt),
        previous: prev.map(fmt),
      });
      cands = out.candidates.map((c) => CandidateSchema.parse(c));
      seasonNote = out.seasonNote;
      source += ` (LLM research: ${llmConfig().provider})`;
    }
    if (!cands || cands.length === 0) {
      const c = llmConfig();
      const note = c.researchSupported
        ? "No candidates came back from research — nothing published."
        : c.enabled
          ? `The ${c.provider} provider has no web search, so research is manual — add candidates on the Refresh tab, then run the refresh.`
          : `No AI provider is connected${c.problem ? ` (${c.problem})` : " (More → Settings → AI provider)"} and no candidates have been entered — add candidates on the Refresh tab, then run the refresh.`;
      setRefresh(db, "waiting_for_candidates", note);
      return { status: "nothing_to_publish", note, kept: [], dropped: [] };
    }
    const result = publishEdition(db, cands, weekLabel, seasonNote, source, { rankByTaste: !source.includes("LLM research") });
    if (fromQueue) db.prepare("DELETE FROM refresh_candidates").run();
    return result;
  } catch (e: any) {
    const note = `Refresh failed: ${e?.message ?? e}`;
    setRefresh(db, "error", note);
    return { status: "error", note, kept: [], dropped: [] };
  }
}

export function discoverRouter(db: DB) {
  const r = express.Router();
  const bad = (res: Response, msg: string, code = 400) => res.status(code).json({ error: msg });

  const editionWithPicks = (e: any) => ({
    ...e,
    picks: db.prepare("SELECT * FROM picks WHERE editionId=? ORDER BY rank, id").all(e.id),
  });

  r.get("/board", (_req, res) => {
    const latest = db.prepare("SELECT * FROM board_editions ORDER BY createdAt DESC, id DESC LIMIT 1").get();
    const past = (db.prepare("SELECT * FROM board_editions ORDER BY createdAt DESC, id DESC").all() as any[]).slice(1);
    res.json({
      latestEdition: latest ? editionWithPicks(latest) : null,
      pastEditions: past.map(editionWithPicks),
      refresh: db.prepare("SELECT lastRunAt, lastStatus, lastNote FROM refresh_state WHERE id=1").get(),
      llm: (({ provider, model, enabled, researchSupported, problem }) => ({ provider, model, enabled, researchSupported, problem }))(llmConfig()),
      candidates: (db.prepare("SELECT * FROM refresh_candidates ORDER BY id").all() as any[]).map((c) => ({ id: c.id, ...JSON.parse(c.data) })),
    });
  });

  r.patch("/picks/:id", (req, res) => {
    const pick = db.prepare("SELECT * FROM picks WHERE id=?").get(req.params.id) as any;
    if (!pick) return bad(res, "Pick not found", 404);
    const status = req.body?.status;
    if (!PICK_STATUSES.includes(status)) return bad(res, "Status must be new, saved, passed or tried.");
    let tasting = null;
    if (status === "tried") {
      const p = TastingSchema.safeParse({
        name: pick.name, roaster: pick.roaster, origin: pick.origin, processMethod: pick.processMethod,
        verdict: req.body?.verdict, notes: req.body?.notes ?? null,
      });
      if (!p.success) return bad(res, "Pick a verdict (loved, liked, not for me, disliked) to mark it tried.");
      const info = db
        .prepare("INSERT INTO tastings (name, roaster, origin, processMethod, verdict, notes, createdAt) VALUES (@name, @roaster, @origin, @processMethod, @verdict, @notes, @createdAt)")
        .run({ ...p.data, origin: p.data.origin ?? null, processMethod: p.data.processMethod ?? null, roaster: p.data.roaster ?? null, notes: p.data.notes ?? null, createdAt: nowIso() });
      tasting = db.prepare("SELECT * FROM tastings WHERE id=?").get(info.lastInsertRowid);
    }
    db.prepare("UPDATE picks SET status=? WHERE id=?").run(status, pick.id);
    res.json({ pick: db.prepare("SELECT * FROM picks WHERE id=?").get(pick.id), tasting });
  });

  /** Add to inventory: calls addToInventory directly — same database, plain function call. */
  r.post("/picks/:id/add-to-inventory", (req, res) => {
    const pick = db.prepare("SELECT * FROM picks WHERE id=?").get(req.params.id) as any;
    if (!pick) return bad(res, "Pick not found", 404);
    db.prepare("UPDATE picks SET inventoryState='adding' WHERE id=?").run(pick.id);
    try {
      const result = addToInventory(db, {
        name: pick.name, roaster: pick.roaster, origin: pick.origin, processMethod: pick.processMethod, tastingNotes: pick.tastingNotes,
        roastLevel: pick.roastLevel, priceAmount: pick.priceAmount, priceText: pick.priceText, url: pick.url,
      });
      db.prepare("UPDATE picks SET inventoryState='added' WHERE id=?").run(pick.id);
      res.json({ ...result, pick: db.prepare("SELECT * FROM picks WHERE id=?").get(pick.id) });
    } catch (e: any) {
      db.prepare("UPDATE picks SET inventoryState='not_added' WHERE id=?").run(pick.id);
      bad(res, `Couldn't add to inventory: ${e.message}`, 500);
    }
  });

  r.get("/tastings", (_req, res) => res.json(db.prepare("SELECT * FROM tastings ORDER BY createdAt DESC, id DESC").all()));
  r.post("/tastings", (req, res) => {
    const p = TastingSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    const d = p.data;
    const info = db
      .prepare("INSERT INTO tastings (name, roaster, origin, processMethod, verdict, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(d.name, d.roaster ?? null, d.origin ?? null, d.processMethod ?? null, d.verdict, d.notes ?? null, nowIso());
    res.json(db.prepare("SELECT * FROM tastings WHERE id=?").get(info.lastInsertRowid));
  });
  r.delete("/tastings/:id", (req, res) => {
    db.prepare("DELETE FROM tastings WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  r.get("/avoids", (_req, res) => res.json(db.prepare("SELECT * FROM avoids ORDER BY id").all()));
  r.post("/avoids", (req, res) => {
    const p = AvoidSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    const d = p.data;
    const info = db.prepare("INSERT INTO avoids (name, roaster, reason, url) VALUES (?, ?, ?, ?)").run(d.name, d.roaster ?? null, d.reason ?? null, d.url ?? null);
    res.json(db.prepare("SELECT * FROM avoids WHERE id=?").get(info.lastInsertRowid));
  });
  r.delete("/avoids/:id", (req, res) => {
    db.prepare("DELETE FROM avoids WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  /* Manual research step: queue candidates for the next refresh. */
  r.post("/candidates", (req, res) => {
    const p = CandidateSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    const info = db.prepare("INSERT INTO refresh_candidates (data, createdAt) VALUES (?, ?)").run(JSON.stringify(p.data), nowIso());
    res.json({ id: Number(info.lastInsertRowid), ...p.data });
  });
  r.delete("/candidates/:id", (req, res) => {
    db.prepare("DELETE FROM refresh_candidates WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  /** Refresh endpoint — manual button, or a host cron. Optional body: { candidates: [...] }. */
  r.post("/refresh", async (req, res) => {
    let cands: Candidate[] | undefined;
    if (Array.isArray(req.body?.candidates)) {
      const parsed = req.body.candidates.map((c: unknown) => CandidateSchema.safeParse(c));
      const badOne = parsed.findIndex((p: any) => !p.success);
      if (badOne >= 0) return bad(res, `Candidate ${badOne + 1}: ${firstError(parsed[badOne].error)}`);
      cands = parsed.map((p: any) => p.data);
    }
    const result = await runRefresh(db, { candidates: cands, trigger: "manual" });
    res.status(result.status === "error" ? 500 : 200).json(result);
  });

  /** Your taste: what Brewlab has learned, the avoid rules, and suggestions. */
  r.get("/taste", (_req, res) => {
    const s = tasteSummary(db);
    const settings = getSettings(db);
    res.json({
      rated: s.rated, stage: s.stage,
      likes: s.likes.map((a) => ({ ...a, text: describe(a) })),
      dislikes: s.dislikes.map((a) => ({ ...a, text: describe(a) })),
      coffees: s.coffees,
      suggestions: avoidSuggestions(db, s, settings),
      defaults: loadTasteDefaults().prefs,
      palateNotes: settings.palateNotes,
      prompt: tasteProfileText(s, settings),
    });
  });
  /** Reset preferences: every section back to the built-in tags, all off (asked first in the app). */
  r.post("/prefs/reset", (_req, res) => {
    res.json(setSettings(db, { prefs: loadTasteDefaults().prefs, dismissedSuggestions: [] }));
  });
  r.post("/suggestions/:id", (req, res) => {
    const id = req.params.id;
    const s = getSettings(db);
    const [section, tagId] = id.split(":");
    const tag = (PREF_SECTIONS as readonly string[]).includes(section) ? s.prefs[section as (typeof PREF_SECTIONS)[number]].exclude.find((t) => t.id === tagId) : undefined;
    if (!tag) return bad(res, "Unknown suggestion", 404);
    if (req.body?.accept) {
      const prefs = structuredClone(s.prefs);
      prefs[section as (typeof PREF_SECTIONS)[number]].exclude.find((t) => t.id === tagId)!.on = true;
      setSettings(db, { prefs });
    }
    else setSettings(db, { dismissedSuggestions: [...new Set([...s.dismissedSuggestions, id])] });
    res.json({ ok: true });
  });

  /** Dry run of the matching rules (no publish) — used by the UI to preview. */
  r.post("/rules/check", (req, res) => {
    const p = CandidateSchema.safeParse(req.body);
    if (!p.success) return bad(res, firstError(p.error));
    res.json(applyMatchingRules([p.data], ruleContext(db)));
  });

  return r;
}
