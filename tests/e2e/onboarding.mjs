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
  await p.locator(".setup-nav").getByRole("button", { name: /^Add \d+ recipes?$/ }).click();

  // Discover
  await p.waitForFunction(() => document.querySelector('[data-testid="setup"]')?.getAttribute("data-step") === "Discover");
  check(true, "step: Discover");
  await p.getByRole("group", { name: "Processes you enjoy" }).getByRole("button", { name: "Washed" }).click();
  await p.waitForTimeout(300);
  check((await (await fetch(`${BASE}/api/setup`)).json()).settings.tasteQuiz.processes.includes("Washed"), "optional taste quiz saves");
  check(await p.locator('[data-testid="ai-provider"]').isVisible(), "AI provider can be set up here (optional)");
  check((await (await fetch(`${BASE}/api/setup`)).json()).settings.avoidRules.length === 0, "a new install starts with no keyword exclusions");
  await p.getByRole("button", { name: "Finish setup" }).click();
  await p.locator("main").getByText("Hoffmann V60").first().waitFor();
  check(true, "setup finished → Recipes, with the starter recipes");
  const recipes = await (await fetch(`${BASE}/api/recipes`)).json();
  const r = recipes.find((x) => x.name === "Hoffmann V60");
  check(r?.grindSetting === "24 clicks" && r?.grinderName === "Comandante C40", `recipe saved with ${r?.grinderName} ${r?.grindSetting}`);
  check((await (await fetch(`${BASE}/api/setup`)).json()).onboarded === true, "onboarded");

  // Settings: run setup again keeps data
  await p.goto(`${BASE}/#/more`);
  await p.getByRole("button", { name: "Run setup again" }).click();
  await p.locator('[data-testid="setup"]').waitFor();
  check(/Nothing you already have is removed/.test(await p.locator("main").innerText()), "re-run explains nothing is removed");
  await p.getByRole("button", { name: "Exit setup" }).click();
  await p.locator('[data-testid="settings"]').waitFor({ timeout: 5000 }).catch(() => {});
  const after = await (await fetch(`${BASE}/api/recipes`)).json();
  check(after.length === recipes.length, "re-running setup kept every recipe");
} catch (e) {
  check(false, `crashed: ${e.message}`);
  await p.screenshot({ path: "onboarding-fail.png" }).catch(() => {});
}
console.log(`\nPage errors: ${errors.length ? errors.join(" | ") : "none"}`);
console.log(`${pass}/${pass + fail} onboarding checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
