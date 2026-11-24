// First-run setup ("onboarding") and settings.
import express, { type Response } from "express";
import path from "node:path";
import { type DB, nowIso } from "./db.js";
import { tidyBags } from "./bags.js";
import { getSettings, setSettings, isOnboarded, setOnboarded } from "./settings.js";
import { compatibleTemplates, renderTemplate, catalogRecipe } from "./catalog.js";
import { ownedGear, runSeed, linkGearToCatalog, normalizeGrindSettings, migrateEspressoCapable } from "./seed.js";
import { recipeRow } from "./routes-brew.js";
import { llmConfig, pingLlm, PROVIDERS } from "./llm.js";
import { readSecrets, writeSecrets } from "./secrets.js";

export const DEMO_DIR = process.env.DEMO_DIR || path.resolve("demo");

// Parents before children, so links resolve on restore.
const DATA_TABLES = ["gear_items", "inventory_items", "water_recipes", "recipes", "brews", "board_editions", "picks", "tastings", "avoids"] as const;

function isEmpty(db: DB) {
  return DATA_TABLES.every((t) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n === 0);
}

export function setupRouter(db: DB) {
  const r = express.Router();
  const bad = (res: Response, msg: string, code = 400) => res.status(code).json({ error: msg });

  r.get("/setup", (_req, res) => res.json({ onboarded: isOnboarded(db), empty: isEmpty(db), settings: getSettings(db) }));

  r.put("/settings", (req, res) => {
    try {
      res.json(setSettings(db, req.body ?? {}));
    } catch (e: any) {
      bad(res, e?.issues?.[0]?.message ? `Invalid setting: ${e.issues[0].path.join(".")} ${e.issues[0].message}` : "Invalid settings");
    }
  });

  r.post("/setup/complete", (_req, res) => {
    setOnboarded(db, true);
    res.json({ onboarded: true });
  });
  /** "Run setup again" from Settings — keeps all data, just shows the steps. */
  r.post("/setup/restart", (_req, res) => {
    setOnboarded(db, false);
    res.json({ onboarded: false });
  });

  /* ---------- AI provider (write-only key; env vars take precedence) ---------- */
  const aiView = () => {
    const c = llmConfig();
    const saved = readSecrets();
    return {
      source: c.source, provider: c.provider, model: c.model, baseUrl: c.baseUrl, enabled: c.enabled,
      researchSupported: c.researchSupported, problem: c.problem,
      // Only whether a key exists — never the key, nor any part of it.
      saved: saved ? { provider: saved.provider, model: saved.model, baseUrl: saved.baseUrl, hasKey: Boolean(saved.apiKey) } : null,
      envOverride: c.source === "environment",
    };
  };
  r.get("/ai", (_req, res) => res.json(aiView()));
  r.put("/ai", (req, res) => {
    const b = req.body ?? {};
    const provider = String(b.provider ?? "");
    if (!(PROVIDERS as readonly string[]).includes(provider)) return bad(res, `Choose a provider: ${PROVIDERS.join(", ")}.`);
    const clean = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const prev = readSecrets();
    // A blank key field keeps the saved key (it's never sent back to fill the field).
    const apiKey = clean(b.apiKey, 4000) ?? (prev && prev.provider === provider ? prev.apiKey : null);
    const model = clean(b.model, 200);
    const baseUrl = clean(b.baseUrl, 500);
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) return bad(res, "The base URL must start with http:// or https://.");
    if (provider !== "openai-compatible" && !apiKey) return bad(res, "Paste an API key for this provider.");
    if (provider !== "anthropic" && !model) return bad(res, "Enter a model id — there's no safe default for this provider.");
    if (provider === "openai-compatible" && !baseUrl) return bad(res, "Enter the base URL of your OpenAI-compatible server (e.g. http://ollama:11434/v1).");
    writeSecrets({ provider, apiKey, model, baseUrl });
    res.json(aiView());
  });
  r.delete("/ai", (_req, res) => {
    writeSecrets(null);
    res.json(aiView());
  });
  r.post("/ai/test", async (_req, res) => {
    const c = llmConfig();
    if (!c.enabled) return bad(res, c.problem || "No AI provider is set up yet.");
    try {
      let timer: NodeJS.Timeout | undefined;
      const reply = await Promise.race([
        pingLlm(),
        new Promise<string>((_, rej) => { timer = setTimeout(() => rej(new Error("No answer within 60 seconds.")), 60_000); }),
      ]).finally(() => clearTimeout(timer));
      res.json({ ok: true, provider: c.provider, model: c.model, reply: reply.slice(0, 80), researchSupported: c.researchSupported });
    } catch (e: any) {
      // Provider errors can echo part of the key ("Incorrect API key provided: sk-…") — scrub it.
      const key = readSecrets()?.apiKey ?? process.env.LLM_API_KEY ?? "";
      let msg = String(e?.message ?? e);
      if (key) msg = msg.split(key).join("[key]");
      msg = msg.replace(/\b(sk-|sk_|AIza|xai-|gsk_)[A-Za-z0-9_\-*.]{4,}/g, "[key]");
      bad(res, `${c.provider} said: ${msg.slice(0, 300)}`, 502);
    }
  });

  /** Starter recipes the user's gear can brew, rendered in their grinder's units. */
  r.get("/setup/templates", (_req, res) => {
    const existing = new Set((db.prepare("SELECT name, brewerId FROM recipes").all() as any[]).map((x) => `${x.name}::${x.brewerId}`));
    res.json(
      compatibleTemplates(ownedGear(db)).map(({ template: t, rendered: x }) => ({
        id: t.id, name: x.name, method: x.method, credit: t.credit ?? null, brewerId: x.brewerId, brewerName: x.brewerName,
        grinderName: x.grinderName, grindSetting: x.grindSetting, grinderId: x.grinderId, doseG: x.doseG, waterG: x.waterG, tempC: x.tempC,
        alreadyAdded: existing.has(`${x.name}::${x.brewerId}`),
      })),
    );
  });
  r.post("/recipes/from-templates", (req, res) => {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return bad(res, "ids must be a list of template ids");
    const owned = ownedGear(db);
    const t = nowIso();
    const created: unknown[] = [];
    let skipped = 0;
    const tx = db.transaction(() => {
      for (const id of ids) {
        const tpl = catalogRecipe(id);
        if (!tpl) throw new Error(`Unknown recipe template "${id}"`);
        const x = renderTemplate(tpl, owned);
        if (!x.compatible) throw new Error(`"${tpl.name}" needs a brewer you don't have`);
        if (db.prepare("SELECT 1 FROM recipes WHERE name=? AND brewerId IS ?").get(x.name, x.brewerId)) {
          skipped++;
          continue;
        }
        const info = db.prepare(
          `INSERT INTO recipes (name, brewerId, brewerName, method, coffee, doseG, waterG, tempC, grinderId, grinderName, grindSetting, steps, notes, favorite, starter, inventoryId, createdAt, updatedAt)
           VALUES (@name, @brewerId, @brewerName, @method, NULL, @doseG, @waterG, @tempC, @grinderId, @grinderName, @grindSetting, @steps, @notes, 0, 1, NULL, @t, @t)`,
        ).run({ ...x, steps: JSON.stringify(x.steps), t });
        created.push(recipeRow(db.prepare("SELECT * FROM recipes WHERE id=?").get(info.lastInsertRowid)));
      }
    });
    try {
      tx();
      res.json({ created, skipped });
    } catch (e: any) {
      bad(res, e.message);
    }
  });

  /** Demo data (fictional) — only into an empty instance. */
  r.post("/setup/demo", (_req, res) => {
    if (!isEmpty(db)) return bad(res, "Demo data can only be loaded into an empty Brewlab.", 409);
    try {
      const report = runSeed(db, DEMO_DIR);
      res.json({ ok: true, report });
    } catch (e: any) {
      bad(res, `Couldn't load the demo: ${e.message}`, 500);
    }
  });

  /** Restore a Brewlab JSON export (More → Backups → Export all data) — only into an empty instance. */
  r.post("/setup/restore", express.json({ limit: "50mb" }), (req, res) => {
    if (!isEmpty(db)) return bad(res, "A backup can only be restored into an empty Brewlab.", 409);
    const ex = req.body;
    if (!ex || ex.app !== "brewlab") return bad(res, "That file isn't a Brewlab export (More → Backups → Export all data).");
    const counts: Record<string, number> = {};
    try {
      db.transaction(() => {
        db.pragma("defer_foreign_keys = ON"); // checked at commit, after every table is in
        for (const table of [...DATA_TABLES, "refresh_state", "refresh_candidates"] as const) {
          const rows: any[] = Array.isArray(ex[table]) ? ex[table] : [];
          if (!rows.length) continue;
          const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
          if (table === "refresh_state") db.prepare("DELETE FROM refresh_state").run();
          for (const row of rows) {
            const keys = Object.keys(row).filter((k) => cols.has(k));
            db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(Object.fromEntries(keys.map((k) => [k, row[k]])));
          }
          counts[table] = rows.length;
        }
      })();
      linkGearToCatalog(db); // exports from before the gear library
      normalizeGrindSettings(db); // exports from before numeric grind settings
      tidyBags(db); // … and from before roast-level lists and tasting-note tags
      migrateEspressoCapable(db); // … and from before per-method "can do"
      setOnboarded(db, true);
      res.json({ ok: true, counts });
    } catch (e: any) {
      bad(res, `Restore failed — nothing was changed: ${e.message}`, 500);
    }
  });

  return r;
}
