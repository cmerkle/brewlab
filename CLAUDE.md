# CLAUDE.md — Brewlab

Guidance for Claude Code and other coding agents (and humans) working on this repo: the rules that
are easy to break and the reasons behind them. CONTRIBUTING.md is the short version for gear and
library contributions. A `CLAUDE.local.md` next to this file (git-ignored) can hold notes about
your own deployment.

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
- **Dose nudge** (`doseAdjustedGrind`) is a setting (`settings.doseNudge`, More → Settings → "Grind for a
  different dose"): on/off, `percent` of the method range per doubling of dose vs the recipe, and
  which methods (default on, 20%, rapid/pourover/batch — `DEFAULT_DOSE_NUDGE`). Shown with a
  one-tap "Use <recipe grind>"; typing a grind turns it off.
- **Roast nudge** (`roastPercent`, `settings.roastNudge`, "Grind for the roast"; off by default; the
  vocab's shifts are an unsourced rule of thumb and are labelled that way in the app): each roast level has a
  `grindShift` (% of the method range, negative = finer) in `catalog/coffee-vocab.json`, overridable in
  `roastNudge.shifts`. The grind moves by the bag's shift minus the shift of the recipe's own `roastLevel`
  (recipes column; else `roastNudge.baseline`, default medium-light). Only exact roast levels count
  (`roastLevelOf`; "as entered" text isn't adjusted). Roast and dose percents are added, then
  `shiftGrind` applies them once (one rounding); Brew setup's note names each reason.
- **Prefer settings and data over constants.** Brewlab aims to be highly configurable: a
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
- Pour steps scale off **water**, not dose. In Brew setup and the ratio calculator (one hook, `useHeldRatio`) the **ratio holds**: typing coffee moves
  the water and typing water moves the coffee; only the ratio field and quick-toggles (1:13–1:17
  plus 1:2) change it, and they hold whichever of coffee/water was edited last (coffee by default).
- The brew timer reads **grams only**, even when the water field is in oz.
- Stash status is derived from dates: unopened → open → finished. Finished bags leave the Stash for
  its Archive (`#/brew/stash/archive`); "Back to stash" clears `finishedDate`. Remaining =
  `amountG` − logged brew doses − `unloggedG` (set by "edit what's left",
  `POST /api/inventory/:id/remaining`; can be negative; kept when the bag size changes). Sorting and
  search are client-side (`src/shared/stash.ts`: `BAG_SORTS`, `sortBags` with missing values last,
  `bagMatches` = every word must match); each tab's sort is a per-device pref.
- **Coffee words are data** (`catalog/coffee-vocab.json`, `GET /api/vocab`): roast levels (id, label,
  aliases, rest, peakEnd), processes, origins, tasting-note suggestions. Roast level is a list
  (`normalizeRoastLevel` matches aliases on save; unknown text kept "as entered"); process/origin
  are lists + Custom. `settings.restWindows` = your overrides by level id (defaults from the vocab);
  `freshnessNote` uses the nearest level. Bags have `tastingNotes` tags (JSON array); imports and
  Discover adds split tasting-note text into tags; `tidyBags` (startup, restore) matches roast
  levels and moves a "Tasting notes: …" notes part into tags once. Tags feed `ratedCoffees` as notes.
- Deleting a bag keeps linked recipes/brews (name kept, link nulled). Same for gear.
- Add-to-inventory dedupes on name + roaster.
- **Discover preferences are tags** (`src/shared/prefs.ts`, Discover → Your taste): `settings.prefs`
  = five sections (roasters, processes, roasts, origins, notes) × three lists — `prefer` / `avoid`
  (soft: prompt lines + `scoreCandidate` ±3 with a reason) and `exclude` ("Do not include", hard:
  the refresh drops a match). Tags `{id, label, on, words?}` can be switched on/off and removed;
  built-in ones come from `catalog/taste-defaults.json`, all off (the old always-leave-out presets
  keep their ids and words: cinnamon, coferment, funk, decaf, dark-roast, blends, robusta, smoky).
  A tag matches when one of its words (else its label or the label's singular) starts a word in
  its section's fields (`sectionText`: a roast tag never looks at tasting notes); exclude reasons
  check notes first. `migrateTastePrefs` moved the old ruleDefs/avoidRules/tasteQuiz/tastePrefs
  once (old keys left in the table); an old rule id (also in seed taste.json) switches on every short
  tag that now covers it (`OLD_RULES`). Built-in labels are one or two words. Suggestions offer to
  switch an exclude tag on, never silently. *Reset preferences* (`POST /api/discover/prefs/reset`, asks
  first; Your taste and setup's Discover step) restores the defaults; running setup again doesn't.
- Discover refresh drops tried, avoided and already-stashed coffees, plus whatever switched-on
  "Do not include" tags match.
- **Water recipes** (`src/shared/water.ts`, `src/server/routes-water.ts`, More → Water): base + volume
  + additives (amount + unit). GH/KH (ppm as CaCO₃) come from additive strengths that are **data**
  (`catalog/water-additives.json`: `ref` = what `amount` `unit` adds to `volume`; salts `calculated`
  from molar mass, products `published` with a source). An unpublished value is `null` → shown as
  "—", never guessed; only g↔mg convert. Library recipes `catalog/water/*.json` need an https source;
  `stated` GH/KH must match the computed value (±10%, `check:catalog` and `npm test`). Recipes
  (`waterId`, default) and brews (`waterId`, used) link to `water_recipes`; deleting a water keeps
  `waterName` (same as bags/gear). Seed: optional `water.json` (`{ id, library }` or full rows).
  **Concentrates**: a water with `concentrate=1` is a stock; other waters add it by g/mg/ml
  (`concentrateId` line → stock ppm × stock litres / total litres). One level only (a concentrate
  can't contain one), not brewed with directly, can't be deleted or un-flagged while a water uses it.
  Library concentrates (Barista Hustle's) are additives of kind `concentrate`, calculated from their salts.
- **Insights** (`src/shared/insights.ts` pure functions, `src/web/insights/`): computed in the browser
  from the loaded brews and bags (no API). Charts are hand-built SVG/HTML, one hue `--chart-1`
  (validated with the dataviz validator on both card surfaces: light #a85a22, dark #cf7f3e — the UI
  accent is too low-chroma for marks), bars ≤ 24px with 4px rounded data ends, solid hairline grid on
  `niceTicks`, a hover/focus tooltip on every mark, and a Table view per card. Card grids are at most two columns with paired cards the same height (the top section pairs Brews per day with When you brew); an odd gear card out is `wide`. Running totals
  (`cumulative`: grams from brews, spend from bag prices on their purchase date) are 2px lines with a
  10% wash, a snapping crosshair (←/→ when focused) and the total labelled at the end. The top filter row (period) scopes everything;
  the Your coffee scope (brews or grams in the period / bags in the stash / every bag) and the Gear and recipes
  measure (brews / grams: `rankBy(…, weight)`) sit on their sections. Days are local; "all time" starts at the first brew.
- **Search and filters** (`src/shared/filters.ts` engine; facets in `brewfilter.ts` `BREW_FACETS`/`BREW_DATES` and
  `stash.ts` `BAG_FACETS`/`BAG_DATES`; UI in `src/web/filters.tsx`): a facet reads one value or a list (tags);
  OR within a facet, AND across; date fields take local-day ranges (an item without that date is left out);
  `facetOptions` counts each value given the other picks and the search. A facet with one value and nothing
  picked isn't shown. Brews are filtered with their bag (`withBags`). The Stash's rest window is `restState`
  (today + `settings.restWindows`); Stash and Archive keep separate filters.
- **Ratings are half stars** (0.5–5, step 0.5; `ratingSchema` in schemas.ts, stored as-is in the INTEGER columns).
  `Stars` input: each star has a left (x.5) and right (x) tap zone. Display with `fmtRating`; Insights shows half
  columns only once a half rating exists (`ratingCounts`).
- **Prometheus metrics** (`src/server/metrics.ts`, `GET /metrics`, text format 0.0.4): off by default
  (`settings.metrics`, Settings → Your data); 404 while off. Computed per scrape from the DB; per-dimension
  families reuse `BREW_FACETS`; per-bag gauges only for bags not finished (bounded labels). Missing label
  values are `none`. History metrics put time in a label (month, day, weekday/hour) so a dashboard is full from
  the first scrape. Never add anything that identifies the user beyond their own data. The Grafana dashboard
  `grafana/brewlab-dashboard.json` is generated by `scripts/grafana-dashboard.mjs` (edit the script, rerun);
  `tests/grafana.test.mjs` fails if it queries a metric the app doesn't serve. The wordmark at the top is a Canvas icon
  loading `grafana/brewlab-wordmark.svg` from jsDelivr (text panels strip images/styles/SVG; Grafana 12 breaks
  data URIs in canvas); Canvas inlines it, so its own `<style>` follows `body.theme-light`. Instant table queries that get
  merged must drop `Time` and `__name__` per frame first, or rows don't join.
- **About / updates** (`src/server/about.ts`, More → Settings → About): version from package.json (`/api/about`,
  also in `/api/health`), links to the repo's releases and issue forms (`.github/ISSUE_TEMPLATE`;
  the bug link pre-fills version and device). `settings.updateCheck` (off by default) asks GitHub's
  releases API once a day (cron 03:00 + startup, at most daily); "Check now" always works. Repo from
  `LIBRARY_REPO`; tests point `UPDATE_CHECK_URL` at a local stub. Never send anything about the user.
- Release: bump `package.json` version, add a `## X.Y.Z` section to CHANGELOG.md, run
  `scripts/upgrade-test.sh` (old tag → this checkout on the same volume) and, for UI changes,
  `tests/e2e/screenshots.mjs`; then push tag `vX.Y.Z`. On GitHub, `release.yml` makes the Release
  from that CHANGELOG section (tag must match package.json) and `docker.yml` publishes the image.

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
- Nightly backups to /data/backups (03:00). How many are kept: `settings.backupKeep` (More → Settings → Backups;
  null = `BACKUP_KEEP`, default 14), applied at once via `PUT /api/backups/retention` and after every
  snapshot. More has back up now, download, delete (`DELETE /api/backups/:name`, names only) and export.
- **Layout model:** `html.tabbar` (App.tsx, from NOT `(hover: hover) and (pointer: fine) and
  (min-width: 900px)`) → full-height flex column, `<main>` scrolls, tab bar in normal flow at the
  bottom (never `position: fixed` — iOS PWAs mis-place fixed bars after fold/rotate). Desktop keeps
  the top nav. iOS 26 standalone bug (WebKit 301108): in `(display-mode: standalone)` the shell uses
  `100lvh`, html `min-height: 100lvh`; don't pin html/body to `height: 100%`. The tab bar ignores
  side safe-area insets and caps the bottom inset at 34px.
- **More** (`#/more`, `More` in More.tsx) lists the pages that aren't in the main bar plus the ratio calculator and Settings
  (`#/more/settings`, `Settings`), which holds every preference card in four groups (Brewing, Discover and AI,
  Your data, App). Which tabs are in More (`inMore`, App.tsx): on touch screens always the `OVERFLOW` tabs
  (Guide, Gear, Water, Insights); on desktop `MainNav` measures a hidden copy of every tab and moves
  `OVERFLOW` tabs into More, Insights first, only when the top bar has no room. A tab in More gets ‹ More. Sub-pages show `<BackButton label="More" />`.
- **Title-bar actions** are rendered by App.tsx from the route (`headerActions()`), never
  registered by pages. "+" buttons `fireAction("new-recipe" | "add-bag" | "log-brew" | "add-gear")`;
  pages handle them with `useAction(...)`. Tests find buttons by aria-label.
- **Brew timer steps move, the clock doesn't:** step start times are `stepTimes(steps, shifts)` (`src/shared/brew.ts`). *Next
  step now* (`nextStepNow`) adds a shift from the next step on, so later steps keep their durations; *Wait* (`waitFor`)
  holds that step past its time (`timerState` → `holding`) until Next step now. The clock is always wall time; shifts
  and waitFor persist with the active brew.
- **Brew timer:** the dialog body is `pinned` (FullScreen `bodyClassName`): clock, current and next
  step stay on screen and only the step list scrolls, following the active step (`StepList follow`).
- **Service worker** (`src/web/public/sw.js`): pages network-first (offline: the cached `/`), `/assets/` cache-first,
  `/api` and `/uploads` never cached. Every cache write goes in `event.waitUntil`, with the response cloned before
  anything reads it — iOS kills the worker after the response, and a lost write left Home Screen apps opening an old
  page offline. The app compares `__APP_VERSION__` (vite define) with `/api/about` on load, focus, visibility and
  `online`, and shows the update bar when they differ.
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
  Every method a grinder can do has a range — gaps are filled with
  **estimates** extrapolated from the grinder's own cited ranges, listed in `rangeInfo.estimated`
  with `estimateNote` (shown as "est."); methods it can't do are listed in `grindRanges.unsupported`
  (the per-row "can do" box in the gear editor; `canGrind`, `rangeFor` ignores them, conversions say
  "<grinder> can't grind for <method>") with a `notes` entry saying why. `espressoCapable` is retired
  (`migrateEspressoCapable` at startup/restore; the API maps an old client's `false` to
  unsupported). Never invent ranges without a cited anchor. **Estimates come from rules that are data**:
  `catalog/estimate-rules.json` (per method, alternatives with `needs` + `low`/`high` expressions,
  evaluated by `src/shared/estimate.ts` — a small parser, never `eval`). The gear editor's
  "Estimate the empty rows" applies them; `npm test` checks every rule-made library estimate equals
  what the rules produce (hand-anchored ones are recognised by their estimateNote and skipped). Installed gear keeps its own copy of `rangeInfo` (source/notes
  editable in the gear editor); `syncGearWithLibrary` (startup) brings untouched copies up to a
  newer library version and only adds missing methods to edited ones. Converter tests use
  `tests/fixtures/spec-grinders.json`, not library values.
- Older installs are linked to the library at startup (`linkGearToCatalog`).
- **Contribution rules live in `CatalogGear`'s superRefine** (catalog.ts) — one set of rules for
  loading, `npm test`, `npm run check:catalog` (CI) and the in-app "Suggest to the library"
  (`libraryEntryFor` → `POST /api/gear/:id/library-entry`: new entry for custom gear, version-bumped
  update with the user's ranges for library gear; nothing is sent — the user opens GitHub's
  new-file/edit page, repo from `LIBRARY_REPO`, default `cmerkle/brewlab`).
- Methods (grind categories), finest → coarsest — `METHODS` order is used everywhere (tables,
  pickers, library JSON): turkish, espresso, moka, aeropress, rapid (OXO), pourover, batch (drip
  coffee maker), immersion (French press), coldbrew. Can't-do cells show "—", never a warning box. Every brewer has
  one (`defaultMethod`; library rule; kinds suggest one via `CATEGORY_METHOD`).
- `recipes.method` / `gear_items.defaultMethod`: conversion needs to know which method range a
  setting sits in (e.g. a Switch as pour-over vs immersion).
- **First-run setup** (`src/web/Setup.tsx`, `src/server/routes-setup.ts`): shown while
  `meta.onboarded` isn't "1"; installs with data are marked onboarded at startup. Preferences in
  the `settings` table (`src/server/settings.ts`): tempUnit (DB always °C — use
  `useTemp`/`TempInput`), waterUnit (instance default; per-device g/oz pref wins), defaultRatio,
  discoverEnabled, prefs, palateNotes, dismissedSuggestions, doseNudge, roastNudge, updateCheck, backupKeep, restWindows. Demo data (`demo/`, fictional) and restore
  only go into an empty DB.
- **Discover taste** (`src/server/taste.ts`): summary from Stash ratings, brew ratings and
  tastings → stage popular (0 rated) / mixed (1–4) / tailored (5+), the research prompt, ranking of
  entered candidates without AI, and avoid-rule suggestions (offered, never applied silently).
  `seed-data/taste.json` (optional) is applied once (`applySeedTaste`).

## Definition of done

`npm run typecheck`, `npm test`, the onboarding e2e on an empty install and the layout audit all
pass. For UI changes, run the audit on the phone and foldable viewports in both orientations.
