# CLAUDE.md — Brewlab

Guidance for Claude Code (and humans) working on this repo. A private `CLAUDE.local.md` may sit
next to it on a maintainer's machine (git-ignored) with deployment-specific notes.

## What this is

Brewlab is a self-hosted coffee app (one Docker container): **Brew** (recipes with a guided
timer, ratio calculator, grind guide/converter, stash, brew log, gear) and **Discover** (a weekly
board that starts with popular picks and learns from the user's ratings), sharing one SQLite
database. One person per instance, no accounts, no login.

## Stack

TypeScript + Vite/React frontend, Node (Express) API, better-sqlite3. Single multi-stage Docker
image (Node 24 Alpine), one service, `restart: unless-stopped`, named volume `brewlab-data:/data`,
SQLite at `/data/brewlab.db`, uploads at `/data/uploads`, port 7642.

## Non-negotiables

- **This repo is public. No personal data** in code, tests, catalog, demo or docs — no real
  addresses, hostnames, emails or someone's coffee history. Tests use fictional names.
  `tests/privacy.test.mjs` checks tracked files against a hashed list of known personal terms.
- There is no login: never weaken the network warnings in README/compose, and keep the link
  importer's private-address guard.
- An AI provider is optional. The app must work fully without one (Tesseract / manual
  candidates). Never "research" coffees from model memory — research needs web search.
- Seed import is idempotent (upsert by id). Never duplicate rows on re-import.
- **Gear is data, never code.** Library ids must not appear in `src/` (a test enforces it).
- If behaviour is ambiguous, ask before guessing. Don't invent behaviour.

## Key domain rules (easy to get wrong)

- Grind conversion is **positional interpolation inside per-method ranges**, NOT microns-per-click
  math. A setting keeps its fractional position in the source range and maps to the same position
  in the target range (halfway through 4.5–5.5 rotations → halfway through 80–100 clicks). Every
  grinder uses its saved `grindRanges` — copied from the gear library when installed, or entered
  by the user. No ranges for a method → "no conversion data yet", and the grinder stays selectable
  with a typed setting. Microns per click is a note only.
- **Grind settings are numbers** (`grindSetting: number | null`) — the "dial" reading you set on
  the grinder; the unit word comes from the grinder (`fmtGrind`). Conversion math runs on the
  linear scale (`dialToValue`/`valueToDial`; they differ only for Ode-style `thirds`: dial 5.1 = 5⅓).
  Legacy text is converted by `normalizeGrindSettings` (startup, seed, restore) and the API schema.
- **Dose nudge** (`doseAdjustedGrind`) is a setting (`settings.doseNudge`, More → "Grind for a
  different dose"): on/off, `percent` of the method range per doubling of dose vs the recipe, and
  which methods (default on, 20%, pourover/batch/rapid — `DEFAULT_DOSE_NUDGE`). Shown with a
  one-tap "Use <recipe grind>"; typing a grind turns it off.
- **Prefer settings and data over constants.** The owner wants Brewlab highly configurable: a
  behaviour with a tunable number or list belongs in `settings` (with a default) or in `catalog/`,
  not hard-coded. Library gear and custom gear share one shape — every field a library entry can
  carry (ranges, per-method notes, notation, dial divisor, where-from/source/note, estimated rows
  and how they were estimated) is editable in the gear editor. Two tests hold this: every library
  entry POSTed as custom gear matches its installed copy (`tests/setup.test.mjs`), and the
  onboarding e2e rebuilds four entries by hand in the editor. A new catalog field needs an editor
  field too.
- Brew flow: **Brew setup** (dose/water/ratio/temp/bag/grinder) → *Ready to brew* → timer screen
  idle at 0:00 → *Start timer* → *Finish* → log (temp and grind still editable). The active brew is
  persisted only once the timer runs.
- Pour steps scale off **water**, not dose. Ratio quick-toggles 1:13–1:17 plus 1:2; they hold
  whichever of coffee/water was edited last (coffee by default).
- The brew timer reads **grams only**, even when the water field is in oz.
- Stash status is derived from dates: unopened → open → finished. Deleting a bag keeps linked
  recipes/brews (name kept, link nulled). Same for gear.
- Add-to-inventory dedupes on name + roaster.
- Discover refresh drops tried, avoided and already-stashed coffees, plus whatever the user's
  "always leave out" rules exclude. Rules are user data: `settings.ruleDefs` ({id, label, keywords})
  starts as `PRESET_RULES` (rules.ts: cinnamon, co-ferment, funk, decaf, dark roast, blends,
  robusta, smoky) and can be edited, deleted, restored or added to; `settings.avoidRules` = ids
  switched on (all off by default). Match = a keyword at the start of a word in name / process /
  tasting notes / notes / "<roast> roast", case and accents folded (`ruleMatch`).

## Commands

- Run: `docker compose up -d --build` · logs: `docker compose logs -f` · health:
  `curl -s localhost:7642/api/health` (inside the container use `127.0.0.1`, not `localhost` —
  Alpine resolves it to IPv6 `::1`)
- Build: `npm run build` (Vite → `dist/public`, tsc → `dist/server.js`) · typecheck:
  `npm run typecheck` · unit tests: `npm run build:server && npm test`
- Local dev server (bind localhost!): `npm run build && HOST=127.0.0.1 DATA_DIR=./.dev-data PORT=3100 DISABLE_CRON=1 npm start`
- E2E (Playwright, `cd tests/e2e && npm i && npx playwright install chromium`):
  - first-run setup on an EMPTY install: `BASE=http://localhost:3103 node onboarding.mjs`
  - layout audit on an install with demo data (`POST /api/setup/demo` then
    `POST /api/setup/complete`), one viewport per process to avoid OOM kills:
    `ONLY="Duo outer landscape" BASE=… node layout-audit.mjs` (iPhone SE / 6.1 / Pro Max, iPhone
    Duo outer / inner / Split View, large foldable × portrait/landscape, desktop; `ONLY="^fold$"`
    runs a live fold/unfold/rotate sequence). Run it after any UI change.
- Manual refresh from a host cron: `curl -XPOST localhost:7642/api/discover/refresh`

## Implementation notes

- Image runs **Node 24 LTS**; dev works on Node 20, so deps stay on Node-20-compatible majors:
  `better-sqlite3@12` (v13 needs Node ≥22), `openai@6`, `@google/genai@2`. Check `engines` before bumping.
- Link importer has an SSRF guard (`isPrivateAddress`, re-checked per redirect hop); tests need
  `IMPORT_ALLOW_HOSTS=<fixture host>`. Shopify `/products/<handle>.js` first, then the page
  (JSON-LD / OG / labelled text; "label on one line, value on the next" only in product context).
  Roaster sites rate-limit server-side fetches (429) — don't vary headers to get around it.
- Nightly backups to /data/backups (03:00, BACKUP_KEEP=14); More has backup/export.
- **Layout model:** `html.tabbar` (App.tsx, from NOT `(hover: hover) and (pointer: fine) and
  (min-width: 900px)`) → full-height flex column, `<main>` scrolls, tab bar in normal flow at the
  bottom (never `position: fixed` — iOS PWAs mis-place fixed bars after fold/rotate). Desktop keeps
  the top nav. iOS 26 standalone bug (WebKit 301108): in `(display-mode: standalone)` the shell uses
  `100lvh`, html `min-height: 100lvh`; don't pin html/body to `height: 100%`. The tab bar ignores
  side safe-area insets and caps the bottom inset at 34px.
- **Title-bar actions** are rendered by App.tsx from the route (`headerActions()`), never
  registered by pages. "+" buttons `fireAction("new-recipe" | "add-bag" | "log-brew" | "add-gear")`;
  pages handle them with `useAction(...)`. Tests find buttons by aria-label.
- **Dialogs** render via a portal to `<body>` (`FullScreen`): iOS WebKit confines fixed overlays
  inside a scroller. Never render a fixed overlay inside `<main>` without a portal; the layout audit
  enforces "dialog directly under body".
- **Back navigation** (always a way back): every dialog uses `FullScreen` — top-left "‹ Back"
  (aria-label "Back"), a history entry, and the left-edge swipe. Never put the only exit at the
  top-right (Dynamic Island). Nested dialogs render as overlays. Sub-pages show `<BackButton label="More" />`.
- WebKit runs: `docker run --rm --network host -v <e2e>:/e2e -w /e2e -e BROWSER=webkit -e BASE=…
  mcr.microsoft.com/playwright:v1.47.2-jammy node …`. Linux WebKit can't synthesize Touch events
  and emulated-viewport resizes go stale — harness limits, not app bugs.
- UI test hooks: recipe rows are collapsed (`recipe-toggle`), row Brew button is
  `data-testid="recipe-brew"`; the g/oz unit and per-recipe grinder are localStorage prefs.
- **LLM** is provider-agnostic (`src/server/llm.ts`): anthropic | openai | gemini |
  openai-compatible, one provider for both features. No guessed default model ids for
  non-Anthropic providers. openai-compatible has no web search → research stays manual.
  Credentials: in-app (`src/server/secrets.ts` → `/data/secrets.json`, 0600, outside the DB, so
  not in exports/backups; write-only API — `/api/ai` returns `hasKey`, never the key; test errors
  scrub key text) or env vars, which win when `LLM_API_KEY`/`LLM_BASE_URL` is set.
- Seed upserts use `INSERT … ON CONFLICT(id) DO UPDATE`, never `INSERT OR REPLACE` (REPLACE
  deletes first, firing `ON DELETE SET NULL`). Seed runs only on first start (`meta.seededAt`),
  from `SEED_DIR` if it has files (see `seed-data/README.md`); starter recipe ids are 1001+.
  `setup.json` may carry per-install `grindRanges` (first install only) and `units` (always win)
  overrides.
- **Gear & recipe library = data** (`catalog/`): `catalog/gear/<id>.json` (specs + grind ranges
  with `rangeInfo` confidence/source) and `catalog/recipes/<id>.json` (templates; grind = position
  0–1 inside the method range, rendered by `renderTemplate`; optional `family` = one per brewer,
  `genericName` = name on a category-matched brewer). Validated by zod in `src/server/catalog.ts`.
  **Ranges need a cited source** (`manufacturer` or `community`); transcribe per-method values.
  Owner decision 2026-11-23: every method a grinder can do has a range — gaps are filled with
  **estimates** extrapolated from the grinder's own cited ranges, listed in `rangeInfo.estimated`
  with `estimateNote` (shown as "est."); methods it can't do get a `notes` entry. Never invent
  ranges without a cited anchor. Installed gear keeps its own copy of `rangeInfo` (source/notes
  editable in the gear editor); `syncGearWithLibrary` (startup) brings untouched copies up to a
  newer library version and only adds missing methods to edited ones. Converter tests use
  `tests/fixtures/spec-grinders.json`, not library values.
- Older installs are linked to the library at startup (`linkGearToCatalog`).
- **Contribution rules live in `CatalogGear`'s superRefine** (catalog.ts) — one set of rules for
  loading, `npm test`, `npm run check:catalog` (CI) and the in-app "Suggest to the library"
  (`libraryEntryFor` → `POST /api/gear/:id/library-entry`: new entry for custom gear, version-bumped
  update with the user's ranges for library gear; nothing is sent — the user opens GitHub's
  new-file/edit page, repo from `LIBRARY_REPO`, default `cmerkle/brewlab`).
- Methods (grind categories), finest → coarsest: turkish, espresso, moka, aeropress, pourover,
  batch (drip coffee maker), immersion (French press), coldbrew, rapid (OXO). Every brewer has
  one (`defaultMethod`; library rule; kinds suggest one via `CATEGORY_METHOD`).
- `recipes.method` / `gear_items.defaultMethod`: conversion needs to know which method range a
  setting sits in (e.g. a Switch as pour-over vs immersion).
- **First-run setup** (`src/web/Setup.tsx`, `src/server/routes-setup.ts`): shown while
  `meta.onboarded` isn't "1"; installs with data are marked onboarded at startup. Preferences in
  the `settings` table (`src/server/settings.ts`): tempUnit (DB always °C — use
  `useTemp`/`TempInput`), waterUnit (instance default; per-device g/oz pref wins), defaultRatio,
  discoverEnabled, ruleDefs/avoidRules, palateNotes, tasteQuiz, doseNudge. Demo data (`demo/`, fictional) and restore
  only go into an empty DB.
- **Discover taste** (`src/server/taste.ts`): summary from Stash ratings, brew ratings and
  tastings → stage popular (0 rated) / mixed (1–4) / tailored (5+), the research prompt, ranking of
  entered candidates without AI, and avoid-rule suggestions (offered, never applied silently).
  `seed-data/taste.json` (optional) is applied once (`applySeedTaste`).

## Definition of done

`npm run typecheck`, `npm test`, the onboarding e2e on an empty install and the layout audit all
pass. For UI changes, run the audit on the phone and foldable viewports in both orientations.
