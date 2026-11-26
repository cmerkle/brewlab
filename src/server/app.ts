import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import { openDb, UPLOAD_DIR, DB_PATH } from "./db.js";
import { seedIfNeeded, counts, linkGearToCatalog, normalizeGrindSettings, syncGearWithLibrary, migrateEspressoCapable } from "./seed.js";
import { loadCatalog, loadWaterCatalog } from "./catalog.js";
import { brewRouter, dedupeRecipes, sweepUploads } from "./routes-brew.js";
import { backupRouter, createBackup } from "./backup.js";
import { waterRouter } from "./routes-water.js";
import { tidyBags } from "./bags.js";
import { discoverRouter, runRefresh } from "./routes-discover.js";
import { llmConfig } from "./llm.js";
import { tesseractAvailable } from "./imports.js";
import { setupRouter } from "./routes-setup.js";
import { markExistingInstallOnboarded, applySeedTaste, migrateTastePrefs } from "./settings.js";
import { SEED_DIR } from "./seed.js";
import { aboutRouter, dailyUpdateCheck, VERSION } from "./about.js";
import { metricsHandler } from "./metrics.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Startup tidy-ups and migrations on a database (logs what changed). */
export function prepareDb(db: ReturnType<typeof openDb>) {
  const lib = loadCatalog();
  if (lib.errors.length) console.warn(`[catalog] ${lib.errors.length} invalid library file(s):\n  ${lib.errors.join("\n  ")}`);
  else console.log(`[catalog] ${lib.gear.length} gear models, ${lib.recipes.length} recipe templates`);
  const wlib = loadWaterCatalog();
  if (wlib.errors.length) console.warn(`[catalog] ${wlib.errors.length} problem(s) in the water library:\n  ${wlib.errors.join("\n  ")}`);
  else console.log(`[catalog] ${wlib.recipes.length} water recipes, ${wlib.additives.length} additives`);
  const seeded = seedIfNeeded(db);
  const linked = linkGearToCatalog(db);
  if (linked) console.log(`[catalog] linked ${linked} existing gear item(s) to the library`);
  const synced = syncGearWithLibrary(db);
  for (const id of synced.updated) console.log(`[catalog] ${id}: ranges updated from the gear library`);
  for (const m of synced.merged) console.log(`[catalog] ${m}: methods added from the gear library (your own ranges kept)`);
  for (const id of migrateEspressoCapable(db)) console.log(`[gear] ${id}: "not espresso-capable" is now "can't do espresso"`);
  const tidied = tidyBags(db);
  if (tidied.roast) console.log(`[stash] ${tidied.roast} roast level(s) matched to the roast list`);
  if (tidied.tags) console.log(`[stash] tasting notes moved into tags on ${tidied.tags} bag(s)`);
  const grinds = normalizeGrindSettings(db);
  if (grinds) console.log(`[grind] ${grinds} grind setting(s) converted to plain numbers`);
  if (seeded) console.log("First run — seed imported:", seeded);
  // Installs that already have data (seeded, or from before first-run setup existed) skip it.
  if (markExistingInstallOnboarded(db)) console.log("[setup] existing data — first-run setup skipped");
  if (migrateTastePrefs(db)) console.log("[discover] taste settings moved to tag-based preferences (what was on stays on)");
  if (applySeedTaste(db, SEED_DIR)) console.log("[discover] taste settings applied from seed data (taste.json)");
  const removed = dedupeRecipes(db);
  if (removed) console.log(`Removed ${removed} duplicate recipe(s).`);
}

/** The JSON API for one database: everything under /api (plus /metrics), ending in the 404 and error handlers. */
export function apiApp(db: ReturnType<typeof openDb>) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", async (_req, res) => {
    const c = llmConfig();
    res.json({
      ok: true, db: process.env.DEMO === "1" ? "in memory (online demo)" : DB_PATH, llm: c.enabled,
      llmProvider: { provider: c.provider, model: c.model, baseUrl: c.baseUrl, researchSupported: c.researchSupported, problem: c.problem },
      ocr: process.env.DEMO !== "1" && (await tesseractAvailable()), counts: counts(db), tz: process.env.TZ ?? null, version: VERSION,
    });
  });
  app.get("/metrics", metricsHandler(db)); // Prometheus; off unless switched on in Settings
  app.use("/api", brewRouter(db));
  app.use("/api", backupRouter(db));
  app.use("/api", waterRouter(db));
  app.use("/api", setupRouter(db));
  app.use("/api", aboutRouter(db));
  app.use("/api/discover", discoverRouter(db));
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(err?.status || 500).json({ error: err?.type === "entity.parse.failed" ? "Malformed JSON" : "Server error" });
  });
  return app;
}

/** The built web app (dist/public), with index.html for every other path; null when not built. */
export function staticApp() {
  const pub = path.join(here, "..", "public"); // dist/server/app.js → dist/public
  if (!fs.existsSync(pub)) return null;
  const app = express.Router();
  app.use(express.static(pub, { index: false }));
  app.get("*", (_req, res) => res.sendFile(path.join(pub, "index.html")));
  return app;
}

export function createApp(db = openDb()) {
  prepareDb(db);
  const app = express();
  app.disable("x-powered-by");
  app.use(apiApp(db));
  app.use("/uploads", express.static(UPLOAD_DIR, { fallthrough: false }));
  const pub = staticApp();
  if (pub) app.use(pub);
  return { app, db };
}

export function startServer() {
  const { app, db } = createApp();
  const port = Number(process.env.PORT || 7642);
  const host = process.env.HOST || "0.0.0.0";
  app.listen(port, host, () => console.log(`Brewlab ${VERSION} listening on http://${host}:${port} (TZ=${process.env.TZ ?? "system"})`));
  const c = llmConfig();
  if (c.problem) console.warn(`[llm] ${c.problem} — LLM features are off; using OCR / manual fallbacks.`);
  else if (c.enabled) console.log(`[llm] ${c.provider} · ${c.model}${c.baseUrl ? ` @ ${c.baseUrl}` : ""} · research ${c.researchSupported ? "on" : "manual (no web search)"}`);
  else console.log("[llm] no LLM configured — using OCR / manual fallbacks.");

  const swept = sweepUploads(db);
  if (swept) console.log(`[uploads] removed ${swept} unused photo(s)`);

  if (process.env.DISABLE_CRON !== "1") dailyUpdateCheck(db).catch(() => {}); // on start too, at most once a day

  // Weekly refresh: Mondays 08:00 local time (TZ).
  if (process.env.DISABLE_CRON !== "1") {
    // Nightly backup 03:00 local (+ unused-upload sweep).
    cron.schedule(
      "0 3 * * *",
      async () => {
        try {
          const b = await createBackup(db, "nightly");
          console.log(`[backup] ${b.name} (${b.bytes} bytes)`);
        } catch (e) {
          console.error("[backup] failed:", e);
        }
        sweepUploads(db);
        // Optional (off by default): is there a newer release on GitHub?
        const u = await dailyUpdateCheck(db);
        if (u?.error) console.warn(`[update] ${u.error}`);
        else if (u) console.log(`[update] latest release: ${u.latest ?? "none yet"}`);
      },
      { timezone: process.env.TZ || "UTC" },
    );
    cron.schedule(
      "0 8 * * 1",
      async () => {
        const r = await runRefresh(db, { trigger: "schedule" });
        console.log(`[refresh] ${r.status}: ${r.note}`);
      },
      { timezone: process.env.TZ || "UTC" },
    );
  }
}
