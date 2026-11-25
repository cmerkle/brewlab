// First-run setup, end to end, on an EMPTY install (no seed data):
//   BASE=http://localhost:3103 node onboarding.mjs
// A stranger adds a V60 and a custom Comandante (calibrated from one setting), picks °F,
// and gets Hoffmann's V60 in Comandante clicks. Then More → Settings → Run setup again.
import { chromium, webkit, devices } from "playwright";

const BASE = process.env.BASE || "http://localhost:3103";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
let pass = 0, fail = 0;
// Closing a dialog goes back one history entry; a reload racing that navigation is aborted.
// Wait for dialogs to close and the page to settle, and retry once if the reload is aborted.
const reload = async () => {
  await p.locator('[role="dialog"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await p.waitForLoadState("load");
  await p.reload().catch(async (e) => {
    if (!/ERR_ABORTED|detached/.test(e.message)) throw e;
    await p.waitForTimeout(300);
    await reload();
  });
};
const check = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); ok ? pass++ : fail++; };
const step = () => p.locator('[data-testid="setup"]').getAttribute("data-step");
const next = () => p.locator(".setup-nav").getByRole("button").first().click();

try {
  const setup0 = await (await fetch(`${BASE}/api/setup`)).json();
  if (!setup0.empty || setup0.onboarded) throw new Error("needs an empty, un-onboarded install (SEED_DIR with no seed files)");

  await p.goto(BASE);
  await p.locator('[data-testid="setup"]').waitFor();
  check((await step()) === "Welcome", "an empty install opens first-run setup");
  check(await p.getByRole("button", { name: /Explore with demo data/ }).isVisible(), "offers demo data and restore");
  await p.getByRole("button", { name: /Set up my gear/ }).click();

  // Brewers
  check((await step()) === "Brewers", "step: brewers");
  await p.getByLabel("Search the brewer library").fill("v60 02");
  await p.getByRole("button", { name: "Add Hario V60 02" }).click();
  await p.getByRole("button", { name: "Remove Hario V60 02" }).waitFor();
  check(true, "V60 02 added from the library");
  await next();

  // Grinders — back works, then a custom grinder with the calibration helper
  check((await step()) === "Grinders", "step: grinders");
  await p.getByRole("button", { name: "Back" }).click();
  check((await step()) === "Brewers", "Back returns to the previous step");
  await next();
  await p.getByRole("button", { name: /add your own grinder/i }).click();
  await p.fill("#cg-name", "Comandante C40");
  await p.selectOption("#cg-units", "clicks");
  await p.fill("#cg-v60", "25");
  await p.locator('[data-testid="calibration"]').waitFor();
  const low = await p.inputValue("#cg-low"), high = await p.inputValue("#cg-high");
  check(low === "22" && high === "28", `calibration proposes a pour-over range around 25 clicks (${low}–${high})`);
  await p.getByRole("button", { name: "Add grinder" }).click();
  await p.locator('[data-testid="setup-yours"]').filter({ hasText: "Comandante C40" }).waitFor();
  check(true, "custom grinder added");
  await next();

  // Preferences
  check((await step()) === "Preferences", "step: preferences");
  await p.getByRole("group", { name: "Temperature" }).getByRole("button", { name: "°F" }).click();
  await p.waitForTimeout(300);
  await next();

  // Starter recipes
  check((await step()) === "Starter recipes", "step: starter recipes");
  const hoff = p.locator('li[data-template="hoffmann-v60"]');
  await hoff.waitFor();
  const detail = await hoff.innerText();
  check(/Comandante C40 24 clicks/.test(detail), `Hoffmann's V60 in Comandante clicks: ${detail.replace(/\s+/g, " ")}`);
  check(/°F/.test(detail), "temperatures shown in °F");
  check(!(await p.locator('li[data-template="aeropress-default"]').count()), "no recipes for gear they don't have");
  check(await hoff.locator("input").isChecked(), "pre-ticked");
  const tplBoxes = p.locator('li[data-template] input[type=checkbox]:not([disabled])');
  await p.getByTestId("tpl-bulk").getByRole("button", { name: "Deselect all" }).click();
  check((await p.locator('li[data-template] input:checked').count()) === 0 && (await p.locator(".setup-nav").getByRole("button", { name: "Next" }).isVisible()), "Deselect all unticks every recipe");
  await p.getByTestId("tpl-bulk").getByRole("button", { name: "Select all", exact: true }).click();
  check((await p.locator('li[data-template] input:checked').count()) === (await tplBoxes.count()), "Select all ticks every recipe you don't have yet");
  await p.locator(".setup-nav").getByRole("button", { name: /^Add \d+ recipes?$/ }).click();

  // Discover
  await p.waitForFunction(() => document.querySelector('[data-testid="setup"]')?.getAttribute("data-step") === "Discover");
  check(true, "step: Discover");
  check(await p.getByTestId("reset-prefs").isVisible(), "setup's Discover step has Reset preferences");
  await p.locator('[data-testid="pref-processes-prefer"]').getByRole("button", { name: "Washed", exact: true }).click();
  await p.waitForTimeout(300);
  const sp = (await (await fetch(`${BASE}/api/setup`)).json()).settings.prefs;
  check(sp.processes.prefer.find((t) => t.label === "Washed")?.on === true, "optional taste tags save (tap Washed under preferred processes)");
  check(await p.locator('[data-testid="ai-provider"]').isVisible(), "AI provider can be set up here (optional)");
  check(Object.values(sp).every((x) => x.exclude.every((t) => !t.on)), "a new install starts with nothing under Do not include");
  await p.getByRole("button", { name: "Finish setup" }).click();
  await p.locator("main").getByText("Hoffmann V60").first().waitFor();
  check(true, "setup finished → Recipes, with the starter recipes");
  const recipes = await (await fetch(`${BASE}/api/recipes`)).json();
  const r = recipes.find((x) => x.name === "Hoffmann V60");
  check(r?.grindSetting === 24 && r?.grinderName === "Comandante C40", `recipe saved with ${r?.grinderName} ${r?.grindSetting}`);
  check((await (await fetch(`${BASE}/api/setup`)).json()).onboarded === true, "onboarded");

  // Step chime: every step change chimes (including the first one after Start), the bell mutes
  // it, and unmuting plays it once. A fake clock and a counter on the oscillators (2 per chime).
  {
    const steps = r.steps.filter((s) => s.atSec != null).map((s) => s.atSec);
    const cctx = await browser.newContext({ ...devices["iPhone 13"] });
    const cp = await cctx.newPage();
    await cp.clock.install();
    await cp.addInitScript(() => {
      window.__osc = 0;
      const AC = window.AudioContext || window.webkitAudioContext;
      const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function () { window.__osc++; return orig.call(this); };
    });
    const chimes = async () => (await cp.evaluate(() => window.__osc)) / 2;
    await cp.goto(`${BASE}/#/brew/recipes`);
    await cp.locator(`[data-testid="recipe-${r.id}"] [data-testid="recipe-brew"]`).click();
    await cp.getByRole("button", { name: "Ready to brew" }).click();
    await cp.getByRole("button", { name: "Start timer" }).click();
    await cp.clock.runFor((steps[1] + 1) * 1000);
    await cp.waitForTimeout(100);
    check(steps.length >= 3 && (await chimes()) === 1, `chime when step 1 → 2 (${await chimes()} chime(s) by ${steps[1] + 1}s)`);
    await cp.getByRole("button", { name: "Mute step chime" }).click();
    await cp.clock.runFor((steps[2] - steps[1]) * 1000);
    await cp.waitForTimeout(100);
    check((await chimes()) === 1, "muted: no chime at the next step");
    await cp.getByRole("button", { name: "Unmute step chime" }).click();
    await cp.waitForTimeout(100);
    check((await chimes()) === 2, "unmuting plays the chime once");
    await cctx.close();
  }

  // Brew setup: numeric grind, nudged for the dose (drip); temperature editable; timer waits for Start.
  await p.goto(`${BASE}/#/brew/recipes`);
  await p.locator(`[data-testid="recipe-${r.id}"] [data-testid="recipe-brew"]`).click();
  await p.getByRole("heading", { name: "Brew setup" }).waitFor();
  check(true, "Brew opens “Brew setup”");
  check((await p.inputValue("#sd-grind")) === "24", `grind is a plain number: ${await p.inputValue("#sd-grind")}`);
  check((await p.inputValue("#sd-temp")) === "212", `recipe temperature shown in °F: ${await p.inputValue("#sd-temp")}`);
  await p.fill("#sd-dose", "15");
  await p.waitForTimeout(200);
  const nudge = p.locator('[data-testid="grind-dose-nudge"]');
  check((await p.inputValue("#sd-grind")) === "23" && /Smaller dose.*finer: 23 clicks instead of 24 clicks/.test(await nudge.innerText()),
    `half the dose on a V60 → a touch finer (${await p.inputValue("#sd-grind")})`);
  await nudge.getByRole("button", { name: "Use 24 clicks" }).click();
  check((await p.inputValue("#sd-grind")) === "24" && !(await nudge.count()), "one tap back to the recipe's grind");
  await p.fill("#sd-grind", "25.5");
  await p.fill("#sd-temp", "205");
  await p.getByRole("button", { name: "Ready to brew" }).click();
  await p.locator('[data-testid="timer-ready"]').waitFor();
  const clock0 = await p.locator('[data-testid="clock"]').innerText();
  await p.waitForTimeout(1300);
  check(clock0 === "0:00" && (await p.locator('[data-testid="clock"]').innerText()) === "0:00", "timer screen waits — it doesn't start on its own");
  check(!(await p.getByRole("button", { name: "Finish" }).count()), "no Finish before Start");
  await p.getByRole("button", { name: "Start timer" }).click();
  await p.waitForTimeout(1300);
  check((await p.locator('[data-testid="clock"]').innerText()) !== "0:00", "Start timer starts it");
  await p.getByRole("button", { name: "Finish" }).click();
  check((await p.inputValue("#lg-temp")) === "205" && (await p.inputValue("#lg-grind")) === "25.5", "log step carries the temperature and grind");
  await p.fill("#lg-temp", "203");
  await p.getByRole("button", { name: "Save brew" }).click();
  await p.getByText("Brew saved to the log").waitFor();
  const logged = (await (await fetch(`${BASE}/api/brews`)).json())[0];
  check(logged.grindSetting === 25.5 && Math.round(logged.tempC * 10) / 10 === 95, `brew logged with grind ${logged.grindSetting} and ${logged.tempC} °C (203 °F)`);

  // Settings: run setup again keeps data — and Discover's taste tags (resetting them is a separate button)
  const before = (await (await fetch(`${BASE}/api/setup`)).json()).settings.prefs;
  before.notes.prefer[0].on = true;
  await fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefs: before }) });
  await p.goto(`${BASE}/#/more`);
  await p.getByTestId("more-pages").waitFor();
  const morePages = await p.getByTestId("more-pages").locator("li").allInnerTexts();
  const moreNames = morePages.map((t) => t.replace(/\s*›\s*$/, "").trim());
  check(JSON.stringify(moreNames) === JSON.stringify(["Grind guide & converter", "Gear", "Water", "Ratio calculator", "Insights", "Settings"]),
    `on a phone, More lists the pages not in the tab bar: ${moreNames.join(", ")}`);
  {
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const d = await dctx.newPage();
    await d.goto(`${BASE}/#/more`);
    await d.getByTestId("more-pages").waitFor();
    const names = (await d.getByTestId("more-pages").locator("li").allInnerTexts()).map((t) => t.replace(/\s*›\s*$/, "").trim());
    check(JSON.stringify(names) === JSON.stringify(["Ratio calculator", "Settings"]), `on desktop (Guide, Gear, Water, Insights in the top nav), More lists: ${names.join(", ")}`);
    // A narrower desktop window: tabs that don't fit the top bar move into More, Insights first.
    for (const w of [1000, 920]) {
      await d.setViewportSize({ width: w, height: 800 });
      await d.waitForTimeout(200);
      const inBar = await d.locator("nav.nav > a").allInnerTexts();
      const inMore = (await d.getByTestId("more-pages").locator("li").allInnerTexts()).map((t) => t.replace(/\s*›\s*$/, "").trim());
      const fits = await d.locator("nav.nav").evaluate((n) => n.scrollWidth <= n.clientWidth);
      const tabs = [["Guide", "Grind guide & converter"], ["Gear", "Gear"], ["Water", "Water"], ["Insights", "Insights"]];
      const once = tabs.every(([bar, more]) => inBar.includes(bar) !== inMore.includes(more));
      check(fits && once && !inBar.includes("Insights") && inMore.includes("Insights"),
        `${w}px desktop: bar ${inBar.join(", ")} · More ${inMore.join(", ")} (each tab in one place, bar fits)`);
    }
    await d.goto(`${BASE}/#/brew/insights`);
    await d.getByRole("button", { name: "Back to More" }).waitFor({ timeout: 3000 }).then(() => check(true, "a tab moved into More gets ‹ More on desktop"), () => check(false, "a tab moved into More gets ‹ More on desktop"));
    await dctx.close();
  }
  await p.getByRole("link", { name: /^Settings/ }).click();
  await p.getByTestId("settings").waitFor();
  check(p.url().endsWith("#/more/settings") && (await p.locator("h1").first().innerText()) === "Settings", "More → Settings opens the settings page");
  await p.getByRole("button", { name: "Back to More" }).click();
  await p.getByTestId("more-pages").waitFor();
  check(p.url().endsWith("#/more"), "Settings → Back to More");
  await p.goto(`${BASE}/#/more/settings`);
  await p.getByRole("button", { name: "Run setup again" }).click();
  await p.locator('[data-testid="setup"]').waitFor();
  check((await (await fetch(`${BASE}/api/setup`)).json()).settings.prefs.notes.prefer[0].on === true, "re-running setup keeps Discover's taste tags");
  check(/Nothing you already have is removed/.test(await p.locator("main").innerText()), "re-run explains nothing is removed");
  await p.getByRole("button", { name: "Exit setup" }).click();
  await p.locator('[data-testid="settings"]').waitFor({ timeout: 5000 }).catch(() => {});
  const after = await (await fetch(`${BASE}/api/recipes`)).json();
  check(after.length === recipes.length, "re-running setup kept every recipe");

  // Phase 5: suggest the custom grinder to the library (nothing is sent; a ready-to-submit entry).
  const gear = await (await fetch(`${BASE}/api/gear`)).json();
  const c40 = gear.find((g) => g.name === "Comandante C40");
  await p.goto(`${BASE}/#/brew/gear`);
  await p.locator(`[data-testid="gear-${c40.id}"]`).waitFor();
  check(!(await p.getByRole("heading", { name: /^Other/ }).count()), "Gear page lists only grinders and brewers");
  await p.locator(`[data-testid="gear-${c40.id}"]`).getByRole("button", { name: "Edit" }).click();
  check(!(await p.locator('#ge-type option[value="other"]').count()), "gear editor has no Other type");
  await p.locator('[data-testid="suggest-open"]').click();
  await p.locator('[data-testid="suggest-json"]').waitFor();
  const issues = await p.locator('[data-testid="suggest-issues"]').innerText();
  check(/already has "comandante-c40"/.test(issues), "a custom grinder that's already in the library is pointed at the library entry");
  check(/source/i.test(issues), "grind ranges without a source can't be submitted");
  check((await p.locator('[data-testid="suggest-github"]').getAttribute("aria-disabled")) === "true", "GitHub link disabled until it passes");
  const json = JSON.parse(await p.locator('[data-testid="suggest-json"]').innerText());
  check(json.name === "Comandante C40" && json.grindRanges?.methods?.pourover?.low === 22, "entry carries the grinder and its calibrated range");
  await p.fill("#sg-source", "https://example.com/c40-chart");
  await p.waitForTimeout(600);
  check(!/source/i.test(await p.locator('[data-testid="suggest-issues"]').innerText()), "adding an https source clears the source problem");
  await p.getByRole("button", { name: "Back" }).last().click(); // the top dialog's Back
  await p.locator('[data-testid="suggest"]').waitFor({ state: "detached" });
  check(await p.locator("#ge-name").isVisible(), "Back closes the suggestion and returns to the gear editor");

  // Grind ranges: the brew-method rows, and an editable source for a custom grinder.
  const rows = await p.locator('[data-testid="range-table"] .rl').allInnerTexts();
  check(JSON.stringify(rows.map((x) => x.replace(/est\.$/, "").trim())) === JSON.stringify(["Turkish", "Espresso", "Moka pot", "AeroPress", "Rapid Brewer", "Pour-over (V60)", "Drip coffee maker", "French press / immersion", "Cold brew"]),
    `range rows follow the grind chart: ${rows.join(" · ")}`);
  check(!(await p.locator('[data-testid="range-source"]').count()) && (await p.inputValue("#ge-source")) === "", "no summary box; a custom grinder starts with an empty source");
  check((await p.locator('[data-testid="range-table"] input[type=checkbox]:checked').count()) === 9, "a new grinder can do every brew method until you untick one");
  await p.getByLabel("Can do Turkish").uncheck();
  check((await p.getByLabel("Turkish low").count()) === 0 && /Can't do/.test(await p.locator('[data-testid="range-table"] [data-method="turkish"]').innerText()), "unticking a method hides its range");
  await p.fill("#ge-source", "https://example.com/my-c40-chart");
  await p.fill("#ge-source-note", "Calibrated against my V60.");
  // Custom gear has every field library gear has: per-method notes, dial notation, divisor.
  await p.getByLabel("Espresso note").fill("Too slow to dial in for espresso.");
  await p.selectOption("#ge-notation", "thirds");
  await p.fill("#ge-divisor", "10");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator(`[data-testid="gear-${c40.id}"]`).waitFor();
  const c40r = (await (await fetch(`${BASE}/api/gear`)).json()).find((g) => g.id === c40.id).grindRanges;
  check(c40r.notes?.espresso === "Too slow to dial in for espresso." && c40r.notation === "thirds" && c40r.dialDivisor === 10 && c40r.unsupported?.join() === "turkish",
    `custom grinder saves notes, notation, divisor and what it can't do: ${JSON.stringify({ n: c40r.notes, t: c40r.notation, d: c40r.dialDivisor, u: c40r.unsupported })}`);
  await p.locator(`[data-testid="gear-${c40.id}"]`).getByRole("button", { name: "Edit" }).click();
  // (put the C40 back on a decimal dial for the rest of the run)
  await p.selectOption("#ge-notation", "decimal");
  await p.fill("#ge-divisor", "");
  check((await p.inputValue("#ge-source")) === "https://example.com/my-c40-chart" && (await p.inputValue("#ge-source-note")) === "Calibrated against my V60." && (await p.inputValue("#ge-confidence")) === "",
    "source, note and 'my own' saved");
  await p.getByLabel("Can do Turkish").check();
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator(`[data-testid="gear-${c40.id}"]`).waitFor();
  // A library grinder brings its source and marks the extrapolated rows.
  const k6 = await (await fetch(`${BASE}/api/gear/from-catalog`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ catalogId: "k6" }) })).json();
  await reload();
  await p.locator(`[data-testid="gear-${k6.id}"]`).getByRole("button", { name: "Edit" }).click();
  check((await p.inputValue("#ge-confidence")) === "manufacturer" && /^https:/.test(await p.inputValue("#ge-source")) && (await p.locator('[data-testid="library-same"]').count()) === 1,
    "a library grinder brings where its ranges come from, in the fields");
  check((await p.locator('[data-testid="range-table"] .est-badge').count()) === 4, "est. badges on the four estimated rows");
  check((await p.getByLabel("Turkish low").inputValue()) === "28", "Turkish from the K6 manual (28–40)");
  check(!(await p.locator('[data-testid="library-ranges"]').count()), "an untouched library grinder doesn't claim to differ from the library");
  await p.getByLabel("Cold brew low").fill("150");
  check((await p.locator('[data-testid="range-table"] .est-badge').count()) === 3, "typing your own value clears that row's est. badge");
  await p.getByRole("button", { name: "Cancel" }).click();

  // "Estimate the empty rows": the library's rules fill ticked rows from the grinder's own ranges.
  await p.goto(`${BASE}/#/brew/gear`);
  await p.getByRole("button", { name: "Add gear" }).click();
  await p.getByRole("button", { name: "Add custom gear" }).click();
  await p.fill("#ge-name", "Estimate Mill");
  await p.selectOption("#ge-type", "grinder");
  await p.getByLabel("Can do Turkish").uncheck();
  for (const [m, lo, hi] of [["Espresso", 10, 20], ["Pour-over (V60)", 30, 40], ["French press / immersion", 50, 60]]) {
    await p.getByLabel(`${m} low`).fill(String(lo));
    await p.getByLabel(`${m} high`).fill(String(hi));
  }
  await p.getByRole("button", { name: "Estimate the empty rows" }).click();
  const estRes = p.locator('[data-testid="estimate-result"]');
  await estRes.waitFor();
  check(/Estimated Moka pot, AeroPress, Rapid Brewer, Drip coffee maker, Cold brew/.test(await estRes.innerText()), `estimate result: ${await estRes.innerText()}`);
  const v = async (m) => `${await p.getByLabel(`${m} low`).inputValue()}–${await p.getByLabel(`${m} high`).inputValue()}`;
  check(await v("AeroPress") === "20–30" && await v("Moka pot") === "20–25" && await v("Drip coffee maker") === "30–40" && await v("Cold brew") === "55–65" && await v("Rapid Brewer") === "25–35",
    `rules applied: AeroPress ${await v("AeroPress")}, moka ${await v("Moka pot")}, drip ${await v("Drip coffee maker")}, cold brew ${await v("Cold brew")}, Rapid ${await v("Rapid Brewer")}`);
  check((await p.locator('[data-testid="range-table"] .est-badge').count()) === 5 && /cold brew: the French press range moved half its width coarser/.test(await p.inputValue("#ge-estimate-note")),
    "estimated rows are marked est. and the explanation is written");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator(".card h3", { hasText: "Estimate Mill" }).waitFor();
  const em = (await (await fetch(`${BASE}/api/gear`)).json()).find((g) => g.name === "Estimate Mill");
  check(em.rangeInfo?.estimated?.join() === "moka,aeropress,rapid,batch,coldbrew" && !em.grindRanges.methods.turkish && em.grindRanges.unsupported?.join() === "turkish",
    `saved with its estimates, and nothing for the method it can't do: ${JSON.stringify(em.rangeInfo?.estimated)}`);

  // Library gear is fully replicable: install an entry, rebuild it by hand in the gear editor,
  // and every field matches.
  const LABEL = { turkish: "Turkish", espresso: "Espresso", moka: "Moka pot", aeropress: "AeroPress", pourover: "Pour-over (V60)",
    batch: "Drip coffee maker", immersion: "French press / immersion", coldbrew: "Cold brew", rapid: "Rapid Brewer" };
  const FIELDS = ["brand", "type", "category", "details", "units", "burrs", "variants", "defaultMethod", "grindRanges", "rangeInfo"];
  const norm = (v) => Array.isArray(v) ? (v.length ? v.map(norm) : undefined)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]).filter(([, x]) => x !== undefined))
    : v === null || v === "" ? undefined : typeof v === "number" ? Math.round(v * 1e9) / 1e9 : v;
  const numText = (n) => { for (const d of [1, 3, 6, 7, 9, 12]) { const k = Math.round(n * d); if (Math.abs(k / d - n) < 1e-9) return d === 1 ? String(k) : Math.abs(Math.round(n * 1000) / 1000 - n) < 1e-9 ? String(n) : `${k}/${d}`; } return String(n); };
  for (const libId of ["k-ultra", "ode-gen2", "df64-gen2", "hario-v60-02"]) {
    const lib = await (await fetch(`${BASE}/api/gear/from-catalog`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ catalogId: libId }) })).json();
    const name = `${lib.name} (by hand)`;
    await p.goto(`${BASE}/#/brew/gear`);
    await p.getByRole("button", { name: "Add gear" }).click();
    await p.getByRole("button", { name: "Add custom gear" }).click();
    await p.fill("#ge-name", name);
    await p.selectOption("#ge-type", lib.type);
    await p.selectOption("#ge-cat", lib.category);
    await p.fill("#ge-brand", lib.brand ?? "");
    await p.fill("#ge-details", lib.details ?? "");
    if (lib.type === "grinder") {
      const r = lib.grindRanges, i = lib.rangeInfo;
      await p.selectOption("#ge-units", lib.units ?? "");
      for (const m of r.unsupported ?? []) await p.getByLabel(`Can do ${LABEL[m]}`).uncheck();
      await p.fill("#ge-burrs", lib.burrs ?? "");
      for (const [m, v] of Object.entries(r.methods)) {
        await p.getByLabel(`${LABEL[m]} low`).fill(numText(v.low));
        await p.getByLabel(`${LABEL[m]} high`).fill(numText(v.high));
      }
      for (const [m, t] of Object.entries(r.notes ?? {})) await p.getByLabel(`${LABEL[m]} note`).fill(t);
      await p.selectOption("#ge-confidence", i.confidence ?? "");
      await p.fill("#ge-source", i.source ?? "");
      await p.fill("#ge-source-note", i.note ?? "");
      for (const m of i.estimated ?? []) await p.getByLabel(`${LABEL[m]} is estimated`).check();
      if (i.estimated?.length) await p.fill("#ge-estimate-note", i.estimateNote ?? "");
      if (r.step != null) await p.fill("#ge-step", numText(r.step));
      if (r.min != null) await p.fill("#ge-min", numText(r.min));
      if (r.max != null) await p.fill("#ge-max", numText(r.max));
      await p.fill("#ge-scale", r.scale ?? "");
      await p.selectOption("#ge-notation", r.notation ?? "decimal");
      if (r.dialDivisor != null) await p.fill("#ge-divisor", numText(r.dialDivisor));
    } else {
      await p.fill("#ge-var", (lib.variants ?? []).join(", "));
      await p.selectOption("#ge-dm", lib.defaultMethod);
    }
    await p.getByRole("button", { name: "Save", exact: true }).click();
    await p.locator(".card h3", { hasText: name }).waitFor({ timeout: 5000 }).catch(() => {});
    const mine = (await (await fetch(`${BASE}/api/gear`)).json()).find((g) => g.name === name);
    const diff = mine ? FIELDS.filter((k) => JSON.stringify(norm(mine[k])) !== JSON.stringify(norm(lib[k]))) : ["(not saved)"];
    check(diff.length === 0, `${libId} rebuilt by hand in the gear editor matches the library copy${diff.length ? ` — differs: ${diff.map((k) => `${k}: ${JSON.stringify(norm(mine?.[k]))} ≠ ${JSON.stringify(norm(lib[k]))}`).join("; ").slice(0, 600)}` : ""}`);
  }

  // More → Settings → Grind for a different dose: on/off, how much, which methods.
  await p.goto(`${BASE}/#/more/settings`);
  const dnCard = p.locator('[data-testid="dose-nudge-settings"]');
  await dnCard.waitFor();
  const dnTable = await dnCard.locator('[data-testid="dose-nudge-table"]').innerText();
  check(/1½×\s+\+11\.7%/.test(dnTable) && /½×\s+−20%/.test(dnTable) && /clicks/.test(dnTable),
    `the setting explains the scaling with a table on your gear: ${dnTable.replace(/\s+/g, " ").slice(0, 160)}`);
  await p.fill("#dn-percent", "40");
  await dnCard.getByLabel("French press / immersion").check();
  await p.waitForTimeout(400);
  let dn = (await (await fetch(`${BASE}/api/setup`)).json()).settings.doseNudge;
  check(dn.percent === 40 && dn.methods.includes("immersion"), `percent and methods saved: ${JSON.stringify(dn)}`);
  await dnCard.getByRole("button", { name: /Back to the defaults/ }).click();
  await dnCard.getByRole("group", { name: "Adjust the grind for the dose" }).getByRole("button", { name: "Off" }).click();
  await p.waitForTimeout(400);
  dn = (await (await fetch(`${BASE}/api/setup`)).json()).settings.doseNudge;
  check(!dn.enabled && dn.percent === 20 && !dn.methods.includes("immersion") && !(await p.locator("#dn-percent").count()), `defaults restored, then switched off: ${JSON.stringify(dn)}`);
  await dnCard.getByRole("group", { name: "Adjust the grind for the dose" }).getByRole("button", { name: "On" }).click();
  await p.waitForTimeout(300);

  // More → About: version, bug report / gear links, update check off by default (not clicked:
  // "Check now" would call GitHub).
  const about = p.locator('[data-testid="about"]');
  await about.waitFor();
  const ver = (await (await fetch(`${BASE}/api/about`)).json()).version;
  check(/^\d+\.\d+\.\d+/.test(ver) && (await about.getByTestId("app-version").innerText()) === ver, `About shows the version (${ver})`);
  check(!(await about.getByTestId("update-check").isChecked()) && /Not checked yet/.test(await about.getByTestId("update-status").innerText()),
    "the update check is off by default and hasn't run");
  const bug = await about.getByTestId("report-bug").getAttribute("href");
  check(/\/issues\/new\?template=bug_report\.yml&version=/.test(bug) && bug.includes(encodeURIComponent(ver)) && /device=/.test(bug),
    "Report a bug opens GitHub's bug form with the version and device filled in");
  check(/template=gear\.yml/.test(await about.getByTestId("request-gear").getAttribute("href")), "Ask for gear opens the gear form");

  // More → Backups: make three, keep 2 (confirm), delete one (confirm), back to the default.
  const bk = p.locator('[data-testid="backups"]');
  const bkRows = bk.locator(".backup-row");
  const bkBefore = await bkRows.count();
  for (let i = 0; i < 3; i++) {
    await bk.getByRole("button", { name: "Back up now" }).click();
    await bkRows.nth(bkBefore + i).waitFor();
    await p.waitForTimeout(1100); // manual backups are named to the second
  }
  const keepDefault = (await (await fetch(`${BASE}/api/backups`)).json()).keepDefault;
  await p.fill("#backup-keep", "2");
  let bkMsg = "";
  p.once("dialog", (d) => { bkMsg = d.message(); d.accept(); });
  await bk.getByRole("button", { name: "Save" }).click();
  await bk.getByRole("button", { name: "Use the default" }).waitFor();
  let bks = await (await fetch(`${BASE}/api/backups`)).json();
  check(/deletes the \d+ oldest backup/.test(bkMsg) && bks.keep === 2 && bks.backups.length === 2 && (await bkRows.count()) === 2, `keeping 2 asks first, then removes the older backups (${bkMsg})`);
  const victim = bks.backups[1].name;
  p.once("dialog", (d) => d.dismiss());
  await bk.getByRole("button", { name: `Delete ${victim}` }).click();
  await p.waitForTimeout(300);
  check((await bkRows.count()) === 2, "cancelling the delete keeps the backup");
  p.once("dialog", (d) => d.accept());
  await bk.getByRole("button", { name: `Delete ${victim}` }).click();
  await bk.getByRole("button", { name: `Delete ${victim}` }).waitFor({ state: "detached" });
  bks = await (await fetch(`${BASE}/api/backups`)).json();
  check(bks.backups.length === 1 && !bks.backups.some((b) => b.name === victim), `a backup can be deleted (${victim})`);
  await bk.getByRole("button", { name: "Use the default" }).click();
  await bk.getByRole("button", { name: "Use the default" }).waitFor({ state: "detached" });
  bks = await (await fetch(`${BASE}/api/backups`)).json();
  check(bks.keep === keepDefault && !bks.custom && (await p.inputValue("#backup-keep")) === String(keepDefault), `"Use the default" goes back to ${keepDefault}`);

  // More → Water: a library water, one of your own (a salt + an additive you describe), set as a
  // recipe's default; Brew setup starts with it; deleting it keeps the name on the recipe.
  const getJ = async (u) => (await fetch(`${BASE}${u}`)).json();
  await p.goto(`${BASE}/#/more`);
  await p.getByRole("link", { name: /^Water/ }).click();
  await p.getByRole("button", { name: "Add water" }).click();
  await p.getByRole("button", { name: "Add Rao/Perger (Lotus drops)" }).click();
  await p.locator('[data-testid="water-lib-lotus-rao-perger"] .tag', { hasText: "added" }).waitFor();
  await p.getByRole("button", { name: "Back" }).last().click();
  let wl = await getJ("/api/water");
  check(wl.length === 1 && wl[0].hardness.gh === 90 && wl[0].catalogId === "lotus-rao-perger", `library water added as your copy (GH ${wl[0]?.hardness.gh}, KH ${wl[0]?.hardness.kh})`);
  await p.getByRole("button", { name: "Make your own" }).click();
  await p.fill("#wr-name", "E2E soft water");
  await p.selectOption("#wr-volunit", "gal");
  await p.getByRole("button", { name: "+ Add an additive" }).click();
  await p.selectOption("#wr-add-0", "epsom-salt");
  await p.fill("#wr-amt-0", "0.5");
  await p.getByRole("button", { name: "+ Add an additive" }).click();
  await p.selectOption("#wr-add-1", "__custom");
  await p.fill("#wr-lname-1", "Mystery drops");
  await p.fill("#wr-amt-1", "3");
  await p.selectOption("#wr-unit-1", "drops");
  const wres = p.locator('[data-testid="water-result"]');
  await p.waitForTimeout(150);
  check(/GH — · KH —/.test(await wres.innerText()) && /Mystery drops: enter what it adds/.test(await wres.innerText()), "an additive with unknown strength leaves GH/KH unknown and says why");
  await p.fill("#wr-lgh-1", "5");
  await p.fill("#wr-lkh-1", "2");
  await p.waitForTimeout(150);
  check(/GH 59 · KH 2/.test(await wres.innerText()), `0.5 g Epsom salt in a gallon + what you entered: ${(await wres.innerText()).split("\n")[0]}`);
  await p.getByRole("button", { name: "Save water" }).click();
  await p.locator('[data-testid="water-form"]').waitFor({ state: "detached" });
  wl = await getJ("/api/water");
  const soft = wl.find((w) => w.name === "E2E soft water");
  check(soft && soft.additives.length === 2 && soft.hardness.gh === 58.6, `your own water saved (GH ${soft?.hardness.gh})`);
  // Set it as a recipe's default water
  const wr = (await getJ("/api/recipes"))[0];
  await p.goto(`${BASE}/#/brew/recipes`);
  await p.locator(`[data-testid="recipe-${wr.id}"] [data-testid="recipe-toggle"]`).click();
  await p.locator(`[data-testid="recipe-${wr.id}"]`).getByRole("button", { name: "Edit" }).click();
  await p.selectOption("#re-waterrec", { label: "E2E soft water" });
  await p.getByRole("button", { name: "Save recipe" }).click();
  await p.locator(`[data-testid="recipe-${wr.id}"] [data-testid="recipe-water"]`, { hasText: "E2E soft water" }).waitFor();
  check(true, "the recipe shows its default water");
  await p.locator(`[data-testid="recipe-${wr.id}"] [data-testid="recipe-brew"]`).first().click();
  await p.locator("#sd-waterrec").waitFor();
  check((await p.inputValue("#sd-waterrec")) === String(soft.id), "Brew setup starts with the recipe's water");
  await p.getByRole("button", { name: "Back" }).last().click();
  // Delete the water: the recipe keeps the name
  await p.goto(`${BASE}/#/brew/water`);
  await p.locator(`[data-testid="water-${soft.id}"]`).getByRole("button", { name: "Edit" }).click();
  p.once("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "Delete" }).click();
  await p.locator(`[data-testid="water-${soft.id}"]`).waitFor({ state: "detached" });
  const wr2 = (await getJ("/api/recipes")).find((x) => x.id === wr.id);
  check(wr2.waterId === null && wr2.waterName === "E2E soft water", "deleting a water keeps its name on the recipe");
  // Your own concentrate (a stock solution), then a water that adds it by the gram.
  await p.getByRole("button", { name: "Make your own" }).click();
  await p.fill("#wr-name", "E2E Ca stock");
  await p.check("#wr-concentrate");
  await p.getByRole("button", { name: "+ Add an additive" }).click();
  await p.selectOption("#wr-add-0", "calcium-chloride-dihydrate");
  await p.fill("#wr-amt-0", "6.8");
  await p.getByRole("button", { name: "Save water" }).click();
  await p.locator('[data-testid="water-form"]').waitFor({ state: "detached" });
  const stockW = (await getJ("/api/water")).find((w) => w.name === "E2E Ca stock");
  check(stockW?.concentrate && stockW.hardness.gh === 4629.4, `a concentrate is saved with its stock strength (GH ${stockW?.hardness.gh})`);
  await p.getByRole("button", { name: "Make your own" }).click();
  await p.fill("#wr-name", "E2E Ca water");
  await p.getByRole("button", { name: "+ Add an additive" }).click();
  await p.selectOption("#wr-add-0", `c:${stockW.id}`);
  await p.fill("#wr-amt-0", "10");
  await p.waitForTimeout(150);
  check(/GH 46 · KH 0/.test(await p.locator('[data-testid="water-result"]').innerText()), "10 g of the stock in 1 L → GH 46");
  await p.getByRole("button", { name: "Save water" }).click();
  await p.locator('[data-testid="water-form"]').waitFor({ state: "detached" });
  const opts = await (async () => { await p.goto(`${BASE}/#/brew/recipes`); await p.locator(`[data-testid="recipe-${wr.id}"] [data-testid="recipe-brew"]`).first().click(); await p.locator("#sd-waterrec").waitFor(); return p.locator("#sd-waterrec option").allInnerTexts(); })();
  check(opts.includes("E2E Ca water") && !opts.includes("E2E Ca stock"), `you brew with waters, not concentrates: ${opts.join(" | ")}`);
  await p.getByRole("button", { name: "Back" }).last().click();

  // Stash → Archive: a finished bag leaves the Stash and waits in the Archive; "Back to stash" undoes it.
  const arcBag = await (await fetch(`${BASE}/api/inventory`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E Archive Bag", openedDate: "2026-01-02" }) })).json();
  await p.goto(`${BASE}/#/brew/stash`);
  await reload(); // the bag was added through the API
  const arcCard = p.locator(`[data-testid="bag-${arcBag.id}"]`);
  await arcCard.getByRole("button", { name: "Mark finished" }).click();
  await p.getByRole("button", { name: "Finish without logging" }).click();
  await arcCard.waitFor({ state: "detached" });
  check(/Archive \(1\)/.test(await p.getByRole("tab", { name: /Archive/ }).innerText()), "a finished bag leaves the Stash (Archive (1))");
  await p.getByRole("tab", { name: /Archive/ }).click();
  await arcCard.waitFor();
  check(p.url().endsWith("#/brew/stash/archive") && /finished/i.test(await arcCard.locator('[data-testid="bag-status"]').innerText()), "…and is in the Archive, marked finished");
  await arcCard.getByRole("button", { name: "Back to stash" }).click();
  await arcCard.waitFor({ state: "detached" });
  await p.getByRole("tab", { name: /In your stash/ }).click();
  await arcCard.waitFor();
  const back = (await (await fetch(`${BASE}/api/inventory`)).json()).find((b) => b.id === arcBag.id);
  check(back.status === "open" && back.finishedDate === null, `"Back to stash" undoes it (${back.status})`);
  // Edit what's left (coffee used without logging a brew)
  await fetch(`${BASE}/api/inventory/${arcBag.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountG: 250 }) });
  await reload();
  await arcCard.getByRole("button", { name: "More actions for E2E Archive Bag" }).click();
  await p.getByRole("menuitem", { name: "Edit" }).click();
  check((await p.inputValue("#bf-left")) === "250", `the bag editor shows the coffee left (${await p.inputValue("#bf-left")} g)`);
  await p.fill("#bf-amount", "300");
  check((await p.inputValue("#bf-left")) === "300", "…which follows the bag size until you type your own");
  await p.fill("#bf-amount", "250");
  await p.fill("#bf-left", "180");
  await p.getByRole("button", { name: "Save bag" }).click();
  await arcCard.locator('[data-testid="bag-unlogged"]').waitFor();
  check((await arcCard.locator('[data-testid="bag-remaining"]').innerText()).startsWith("180 g of 250") && /Includes 70 g used without a logged brew/.test(await arcCard.locator('[data-testid="bag-unlogged"]').innerText()),
    "coffee left is edited in the bag editor; the card says how much was used without a brew");
  // Sort and search the Stash
  for (const [name, roaster, roastDate] of [["E2E Zebra Natural", "Aardvark Roasters", "2026-10-01"], ["E2E Apple Washed", "Zulu Coffee", "2026-11-05"]])
    await fetch(`${BASE}/api/inventory`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, roaster, roastDate }) });
  await reload();
  const firstBag = async () => (await p.locator(".cards .bag h3").first().innerText()).trim();
  await p.getByLabel("Search your stash").fill("e2e");
  await p.selectOption('select[aria-label="Sort by"]', "name");
  const n1 = await firstBag();
  await p.getByTestId("sort-dir").click();
  const n2 = await firstBag();
  await p.selectOption('select[aria-label="Sort by"]', "roaster");
  const r1 = await firstBag();
  await p.selectOption('select[aria-label="Sort by"]', "roastDate");
  const d1 = await firstBag();
  check(n1 === "E2E Apple Washed" && n2 === "E2E Zebra Natural" && r1 === "E2E Zebra Natural" && d1 === "E2E Apple Washed",
    `sort by name (A→Z, then Z→A), roaster, roast date (newest first): ${[n1, n2, r1, d1].join(" / ")}`);
  await p.getByLabel("Search your stash").fill("zulu");
  check((await p.locator(".cards .bag").count()) === 1 && (await firstBag()) === "E2E Apple Washed", "search finds a bag by its roaster");
  await p.getByLabel("Search your stash").fill("october");
  check((await p.locator(".cards .bag").count()) === 1 && (await firstBag()) === "E2E Zebra Natural", "…and by its roast month");
  await p.getByLabel("Search your stash").fill("no such coffee");
  check(await p.getByTestId("stash-no-match").isVisible(), "no match says so");
  await reload();
  check((await p.inputValue('select[aria-label="Sort by"]')) === "roastDate", "the sort is remembered on this device");
  // A bag with the lists: roast level, a listed process, your own origin, tasting-note tags
  await p.getByRole("button", { name: "Add a bag" }).click();
  await p.fill("#bf-name", "E2E Tagged");
  await p.selectOption("#bf-roastLevel", "Light");
  await p.selectOption("#bf-processMethod", "Washed");
  await p.selectOption("#bf-origin", "__custom");
  await p.fill("#bf-origin-custom", "Finca Imaginaria, Huila");
  await p.fill("#bf-tags", "Strawberry");
  await p.press("#bf-tags", "Enter");
  await p.fill("#bf-tags", "citrus,");
  const rd = new Date(Date.now() - 5 * 86400000).toLocaleDateString("en-CA");
  await p.fill("#bf-roastDate", rd);
  await p.getByRole("button", { name: "Save bag" }).click();
  await p.locator('[data-testid="bag-form"], [role="dialog"]').first().waitFor({ state: "detached" });
  const tb = (await (await fetch(`${BASE}/api/inventory`)).json()).find((b) => b.name === "E2E Tagged");
  check(tb && tb.roastLevel === "Light" && tb.processMethod === "Washed" && tb.origin === "Finca Imaginaria, Huila" && tb.tastingNotes.join() === "strawberry,citrus",
    `roast level, process, your own origin and tags saved: ${JSON.stringify(tb && [tb.roastLevel, tb.processMethod, tb.origin, tb.tastingNotes])}`);
  await p.getByLabel("Search your stash").fill("strawberry");
  const tcard = p.locator(`[data-testid="bag-${tb.id}"]`);
  await tcard.waitFor();
  check(/resting; usually best from about day 10 for a light roast/.test(await tcard.innerText()) && /strawberry/.test(await tcard.locator('[data-testid="bag-tags"]').innerText()),
    "the card shows the tags and a light roast's rest (day 10); search finds a tag");
  // Your own rest window for light roasts
  await p.goto(`${BASE}/#/more/settings`);
  const rest = p.locator('[data-testid="rest-settings"]');
  await rest.getByLabel("Light: best from day", { exact: true }).fill("4");
  await rest.getByRole("button", { name: "Save" }).click();
  await rest.getByRole("button", { name: "Back to the starting values" }).waitFor();
  await p.goto(`${BASE}/#/brew/stash`);
  await p.getByLabel("Search your stash").fill("strawberry");
  check(/in its peak window for a light roast/.test(await tcard.innerText()), "with light roasts resting 4 days, the 5-day-old bag is in its peak window");
  await p.goto(`${BASE}/#/more/settings`);
  await rest.getByRole("button", { name: "Back to the starting values" }).click();
  await rest.getByRole("button", { name: "Back to the starting values" }).waitFor({ state: "detached" });
  // Discover → Your taste: five tag sections × Preferred / Rather avoid / Do not include.
  await fetch(`${BASE}/api/discover/prefs/reset`, { method: "POST" }); // start from the built-in tags
  await p.goto(`${BASE}/#/discover/taste`);
  await reload();
  await p.locator('[data-testid="prefs-notes"]').waitFor();
  for (const sec of ["roasters", "processes", "roasts", "origins", "notes"]) check(await p.locator(`[data-testid="prefs-${sec}"]`).isVisible(), `section: ${sec}`);
  check(!(await p.locator('[data-testid="avoid-rules"], [data-testid="taste-quiz"]').count()), "no separate quiz or always-leave-out sections");
  check((await p.locator('[data-testid="prefs-notes"] .ptag.on').count()) === 0 && (await p.locator('[data-testid="prefs-notes"] .ptag').count()) > 20, "built-in tags are there, all off");
  check(await p.locator('[data-testid="pref-roasts-prefer"]').getByRole("button", { name: "Ultra light", exact: true }).isVisible(), "roast level includes Ultra light");
  const tagIn = (id) => p.locator(`[data-testid="${id}"]`);
  // Toggle a built-in "Do not include" tag on
  await tagIn("pref-notes-exclude").getByRole("button", { name: "Cinnamon", exact: true }).click();
  // Add your own tags
  for (const [id, text] of [["pref-origins-exclude", "Peaberries"], ["pref-roasters-prefer", "Good Roasters"], ["pref-origins-avoid", "Sumatra"], ["pref-notes-prefer", "Strawberry jam"]]) {
    await p.fill(`#${id}`, text);
    await p.press(`#${id}`, "Enter");
  }
  // Remove a built-in tag, then restore it
  await tagIn("pref-origins-exclude").getByRole("button", { name: "Remove Blend" }).click();
  await p.waitForTimeout(500);
  let pr = (await (await fetch(`${BASE}/api/setup`)).json()).settings.prefs;
  const onL = (sec, list) => pr[sec][list].filter((t) => t.on).map((t) => t.label);
  check(onL("notes", "exclude").join() === "Cinnamon" && onL("origins", "exclude").join() === "Peaberries" && onL("roasters", "prefer").join() === "Good Roasters"
    && onL("origins", "avoid").join() === "Sumatra" && onL("notes", "prefer").join() === "Strawberry jam" && !pr.origins.exclude.some((t) => t.id === "blends"),
    "tap toggles a tag, Enter adds one (switched on), × removes one");
  await p.locator('[data-testid="prefs-origins"]').getByRole("button", { name: /Restore 1 built-in tag you removed/ }).click();
  await p.waitForTimeout(400);
  pr = (await (await fetch(`${BASE}/api/setup`)).json()).settings.prefs;
  check(pr.origins.exclude.find((t) => t.id === "blends")?.on === false, "a removed built-in tag can be restored (off)");
  await tagIn("pref-roasters-prefer").getByRole("button", { name: "Good Roasters", exact: true }).click();
  await p.waitForTimeout(400);
  pr = (await (await fetch(`${BASE}/api/setup`)).json()).settings.prefs;
  check(pr.roasters.prefer.find((t) => t.label === "Good Roasters")?.on === false, "your own tags toggle off too");
  await tagIn("pref-roasters-prefer").getByRole("button", { name: "Good Roasters", exact: true }).click();
  await p.waitForTimeout(400);
  const dropped = await (await fetch(`${BASE}/api/discover/rules/check`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "pick", name: "Kenya Peaberry", roaster: "R", origin: "Kenya", processMethod: "Washed", tastingNotes: "blackcurrant", roastLevel: "Light", priceAmount: 20, priceText: "$20", url: "", whyFit: "", brewTip: "", funkRisk: "low" }) })).json();
  check(/peaberries/.test(dropped.dropped?.[0]?.reason ?? ""), `Do not include leaves matching coffees out: ${dropped.dropped?.[0]?.reason}`);
  await p.reload();
  await p.getByRole("button", { name: /Show what the weekly research is told/ }).click();
  const told = await p.locator('[data-testid="taste-prompt"]').innerText();
  check(/Roasters: Good Roasters/.test(told) && /Origins: Sumatra/.test(told) && /Tasting notes: Strawberry jam/.test(told) && /Peaberries/.test(told), "the research is told about the tags that are on");
  // Reset preferences: cancel keeps them; OK puts every section back to the built-in tags, all off
  p.once("dialog", (d) => d.dismiss());
  await p.getByTestId("reset-prefs").click();
  await p.waitForTimeout(300);
  check((await (await fetch(`${BASE}/api/setup`)).json()).settings.prefs.roasters.prefer.length === 1, "cancelling Reset preferences keeps them");
  let resetMsg = "";
  p.once("dialog", (d) => { resetMsg = d.message(); d.accept(); });
  await p.getByTestId("reset-prefs").click();
  await p.locator('[data-testid="pref-roasters-prefer"] .ptag').first().waitFor({ state: "detached" });
  const rp = (await (await fetch(`${BASE}/api/setup`)).json()).settings.prefs;
  check(/Reset your Discover preferences/.test(resetMsg) && rp.roasters.prefer.length === 0 && Object.values(rp).every((x) => Object.values(x).every((l) => l.every((t) => !t.on)))
    && rp.origins.exclude.some((t) => t.id === "blends"), "Reset preferences (after asking): built-in tags back, all off, your own removed");

  // More → Insights: the numbers agree with the data; period, table view and keyboard tooltip work.
  await p.goto(`${BASE}/#/more`);
  await p.getByRole("link", { name: /^Insights/ }).click();
  await p.getByTestId("insights").waitFor();
  const allBrews = await (await fetch(`${BASE}/api/brews`)).json();
  const since = (days) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1 - days); return allBrews.filter((b) => new Date(b.brewedAt) >= d); };
  await p.getByRole("button", { name: "30 days" }).click();
  const b30 = since(30);
  check((await p.getByTestId("hero-brews").innerText()) === String(b30.length), `hero shows ${b30.length} brews in 30 days`);
  const g30 = Math.round(b30.reduce((a, b) => a + (b.doseG ?? 0), 0));
  check((await p.getByTestId("kpi-grams").innerText()).includes(`${g30} g`), `coffee used: ${g30} g`);
  await p.getByRole("button", { name: "All time" }).click();
  check((await p.getByTestId("hero-brews").innerText()) === String(allBrews.length), "all time counts every brew");
  const tl = p.getByTestId("chart-timeline");
  await tl.getByRole("button", { name: "Table" }).click();
  const tableTotal = (await tl.locator("tbody tr td:nth-child(2)").allInnerTexts()).reduce((a, t) => a + Number(t), 0);
  check(tableTotal === allBrews.length, `the table view adds up (${tableTotal})`);
  await tl.getByRole("button", { name: "Chart" }).click();
  await tl.locator("rect.hit").last().focus();
  check(/brew/.test(await tl.locator(".tip").innerText()), "keyboard focus on a column shows its tooltip");
  const brewers = p.getByTestId("chart-brewers");
  check(/Hario V60 02/.test(await brewers.innerText()), "brews per brewer lists the V60");
  // Gear by coffee used: grams per grinder add up to the brews that recorded a grinder
  await p.getByRole("group", { name: "Gear and recipes by" }).getByRole("button", { name: "Coffee used" }).click();
  const gr = p.getByTestId("chart-grinders");
  await gr.getByRole("button", { name: "Table" }).click();
  const gSum = (await gr.locator("tbody tr td:nth-child(2)").allInnerTexts()).reduce((a, t) => a + Number(t.replace(/[^\d.]/g, "")), 0);
  const want = Math.round(allBrews.filter((b) => b.grinderName).reduce((a, b) => a + (b.doseG ?? 0), 0));
  check(Math.abs(gSum - want) <= 1 && /Coffee \(g\)/.test(await gr.locator("thead").innerText()), `coffee used per grinder adds up (${gSum} g of ${want} g)`);
  await gr.getByRole("button", { name: "Chart" }).click();
  await p.getByRole("group", { name: "Gear and recipes by" }).getByRole("button", { name: "Brews" }).click();
  const hm = await p.evaluate(() => {
    const cells = [...document.querySelectorAll(".heatmap > .hm-cell")].map((c) => c.getBoundingClientRect());
    const head = Math.max(...[...document.querySelectorAll(".hm-col")].map((c) => c.getBoundingClientRect().bottom));
    let overlaps = 0;
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) { const a = cells[i], c = cells[j]; if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) overlaps++; }
    return { n: cells.length, overlaps, belowHead: cells.every((c) => c.top >= head - 0.5) };
  });
  check(hm.n === 56 && hm.overlaps === 0 && hm.belowHead, `heatmap: 56 separate cells, below the hour labels (${JSON.stringify(hm)})`);
  check(!(await p.locator(".insight-filters select").count()), "the top filter row holds only the period");
  // Running totals: the last value is the period total (the same as the headline tile)
  const cg = p.getByTestId("chart-cum-grams");
  await cg.getByRole("button", { name: "Table" }).click();
  const lastTotal = Number((await cg.locator("tbody tr").last().locator("td").last().innerText()).replace(/[^\d.]/g, ""));
  const allGrams = Math.round(allBrews.reduce((a, b) => a + (b.doseG ?? 0), 0));
  check(Math.round(lastTotal) === allGrams, `coffee used, running total ends at ${lastTotal} g (all brews: ${allGrams} g)`);
  await cg.getByRole("button", { name: "Chart" }).click();
  await cg.locator("svg").focus();
  await p.keyboard.press("ArrowLeft");
  check(/so far/.test(await cg.locator(".tip").innerText()), "the running total's crosshair moves with the arrow keys");
  const spentTile = await p.getByText("Spent on bags").locator("..").innerText();
  const spentSub = await p.getByTestId("chart-cum-spend").locator(".insight-title .muted").innerText();
  check(spentTile.includes(spentSub.split("· ")[1] ?? "?") || (/—/.test(spentTile) && /\$0/.test(spentSub)), `spent on beans agrees with the headline (${spentSub.split("· ")[1]})`);
  // Your coffee by grams: each roaster's coffee adds up to the brews made from Stash bags with a roaster.
  await p.selectOption('select[aria-label="Your coffee charts count"]', "grams");
  const cr = p.getByTestId("chart-coffee-roaster");
  await cr.getByRole("button", { name: "Table" }).click();
  const crHead = await cr.locator("thead").innerText();
  const crSum = (await cr.locator("tbody tr td:nth-child(2)").allInnerTexts()).reduce((a, t) => a + Number(t.replace(/[^\d.]/g, "")), 0);
  const bagsNow = await (await fetch(`${BASE}/api/inventory`)).json();
  const roasterOf = new Map((Array.isArray(bagsNow) ? bagsNow : bagsNow.items ?? []).map((b) => [b.id, b.roaster]));
  const wantG = allBrews.filter((b) => b.inventoryId != null && roasterOf.get(b.inventoryId)).reduce((a, b) => a + (b.doseG ?? 0), 0);
  check(/Coffee \(g\)/.test(crHead) && Math.abs(crSum - wantG) <= 4, `coffee used per roaster adds up: ${crSum} g (brews from bags with a roaster: ${wantG} g)`);
  await cr.getByRole("button", { name: "Chart" }).click();
  await p.selectOption('select[aria-label="Your coffee charts count"]', "stash");
  check(/Open and unopened bags/.test(await p.getByTestId("coffee-scope-hint").innerText()), "the Your coffee scope sits with its charts and says what it counts");

  // Bag photos: take / choose / paste (no camera-only), converted to JPEG on the device.
  await p.goto(`${BASE}/#/brew/stash`);
  await p.getByRole("button", { name: "Add a bag" }).click();
  const picker = p.locator('[data-testid="bf-photo-picker"]');
  for (const b of ["Take photo", "Choose photo or file", "Paste image"]) check(await picker.getByRole("button", { name: b }).isVisible(), `photo option: ${b}`);
  check((await p.locator("#bf-photo-choose").getAttribute("capture")) === null, "Choose doesn't force the camera");
  const png = await p.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 900; c.height = 600;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 900, 600); g.fillStyle = "#000"; g.font = "64px sans-serif"; g.fillText("TEST ROASTERS", 80, 300);
    return c.toDataURL("image/png").split(",")[1];
  });
  const uploads = [];
  p.on("request", (r) => { if (r.url().includes("/api/import/photo")) uploads.push(r.headers()["content-type"] ?? ""); });
  await p.setInputFiles("#bf-photo-choose", { name: "screenshot.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await p.locator('[data-testid="import-result"]').waitFor({ timeout: 90000 });
  check(uploads.length === 1, "a chosen image is uploaded and read");
  check(await p.locator("img.bag-photo").isVisible(), "the photo is attached to the bag");
  check((await p.locator("img.bag-photo").getAttribute("src")).endsWith(".jpg"), "converted to JPEG on the device");
  check(!(await p.locator('[data-testid="lookup-online"]').count()), "no “look it up online” without a search-capable AI provider");
  // Paste (⌘V): an image on the clipboard goes through the same path.
  await p.getByRole("button", { name: "Remove photo" }).click();
  await p.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  }, png);
  await p.locator("img.bag-photo").waitFor({ timeout: 90000 });
  check(uploads.length === 2, "pasting an image (⌘V) reads it too");
  await p.getByRole("button", { name: "Back" }).last().click();

  // Duplicate a bag (bought more than one): coffee details copied, a new unopened bag.
  const orig = await (await fetch(`${BASE}/api/inventory`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Twin Peaks", roaster: "Sample Roasters", origin: "Kenya", processMethod: "Washed", roastDate: "2026-11-01",
      purchaseDate: "2026-11-05", openedDate: "2026-11-06", amountG: 250, price: 19, rating: 4, notes: "Two bags bought", source: "manual" }) })).json();
  await p.goto(`${BASE}/#/brew/stash`);
  await reload(); // the bag was created through the API — load it
  await p.locator(`[data-testid="bag-${orig.id}"] .menu .icon-btn`).click();
  await p.getByRole("menuitem", { name: "Duplicate" }).click();
  await p.locator('[data-testid="bag-copy-note"]').waitFor();
  check(await p.getByRole("heading", { name: "Add another bag" }).isVisible(), "Duplicate opens “Add another bag”");
  const val = (id) => p.inputValue(id);
  check((await val("#bf-name")) === "Twin Peaks" && (await val("#bf-roaster")) === "Sample Roasters" && (await val("#bf-origin")) === "Kenya", "coffee details copied");
  check((await val("#bf-roastDate")) === "2026-11-01" && (await val("#bf-purchaseDate")) === "2026-11-05", "dates copied");
  check((await val("#bf-openedDate")) === "" && (await val("#bf-finishedDate")) === "", "opened/finished start empty (a new bag)");
  check(!(await p.locator('[data-testid="bf-photo-picker"]').count()), "no import section on a copy");
  await p.fill("#bf-roastDate", "2026-11-03");
  await p.getByRole("button", { name: "Save bag" }).click();
  await p.locator('[data-testid="bag-copy-note"]').waitFor({ state: "detached" });
  const twins = (await (await fetch(`${BASE}/api/inventory`)).json()).filter((b) => b.name === "Twin Peaks");
  const copy = twins.find((b) => b.id !== orig.id);
  check(twins.length === 2, "two bags of the same coffee in the Stash");
  check(copy && copy.status === "unopened" && copy.rating == null && copy.amountG === 250 && copy.price === 19 && copy.roastDate === "2026-11-03", "the copy: unopened, unrated, same size/price, edited roast date");
  const o2 = twins.find((b) => b.id === orig.id);
  check(o2.status === "open" && o2.rating === 4 && o2.roastDate === "2026-11-01", "the original is unchanged");
} catch (e) {
  check(false, `crashed: ${e.message}`);
  await p.screenshot({ path: "onboarding-fail.png" }).catch(() => {});
}
console.log(`\nPage errors: ${errors.length ? errors.join(" | ") : "none"}`);
console.log(`${pass}/${pass + fail} onboarding checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
