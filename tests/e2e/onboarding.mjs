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
  check(r?.grindSetting === 24 && r?.grinderName === "Comandante C40", `recipe saved with ${r?.grinderName} ${r?.grindSetting}`);
  check((await (await fetch(`${BASE}/api/setup`)).json()).onboarded === true, "onboarded");

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

  // Settings: run setup again keeps data
  await p.goto(`${BASE}/#/more`);
  await p.getByRole("button", { name: "Run setup again" }).click();
  await p.locator('[data-testid="setup"]').waitFor();
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
  check(JSON.stringify(rows.map((x) => x.replace(/est\.$/, "").trim())) === JSON.stringify(["Turkish", "Espresso", "Moka pot", "AeroPress", "Pour-over (V60)", "Drip coffee maker", "French press / immersion", "Cold brew", "Rapid Brewer"]),
    `range rows follow the grind chart: ${rows.join(" · ")}`);
  check(/No source yet/.test(await p.locator('[data-testid="range-source"]').innerText()), "a custom grinder starts with no source");
  await p.fill("#ge-source", "https://example.com/my-c40-chart");
  await p.fill("#ge-source-note", "Calibrated against my V60.");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator(`[data-testid="gear-${c40.id}"]`).getByRole("button", { name: "Edit" }).click();
  const src = p.locator('[data-testid="range-source"]');
  check(/Your ranges — Calibrated against my V60\./.test(await src.innerText()) && (await src.locator("a").getAttribute("href")) === "https://example.com/my-c40-chart",
    `source saved and shown: ${(await src.innerText()).replace(/\s+/g, " ")}`);
  await p.getByRole("button", { name: "Cancel" }).click();
  // A library grinder brings its source and marks the extrapolated rows.
  const k6 = await (await fetch(`${BASE}/api/gear/from-catalog`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ catalogId: "k6" }) })).json();
  await p.reload();
  await p.locator(`[data-testid="gear-${k6.id}"]`).getByRole("button", { name: "Edit" }).click();
  const k6src = await p.locator('[data-testid="range-source"]').innerText();
  check(/From the gear library — the maker's chart/.test(k6src) && /Estimated \(est\.\): Drip coffee maker, French press \/ immersion, Cold brew, Rapid Brewer/.test(k6src), `K6 source + estimates: ${k6src.replace(/\s+/g, " ").slice(0, 160)}`);
  check((await p.locator('[data-testid="range-table"] .est-badge').count()) === 4, "est. badges on the four estimated rows");
  check((await p.getByLabel("Turkish low").inputValue()) === "28", "Turkish from the K6 manual (28–40)");
  await p.getByLabel("Cold brew low").fill("150");
  check((await p.locator('[data-testid="range-table"] .est-badge').count()) === 3, "typing your own value clears that row's est. badge");
  await p.getByRole("button", { name: "Cancel" }).click();

  // Discover → Your taste: "always leave out" rules are the user's own.
  await p.goto(`${BASE}/#/discover/taste`);
  const rulesCard = p.locator('[data-testid="avoid-rules"]');
  await rulesCard.waitFor();
  check(/Hard filters/.test(await rulesCard.innerText()) && /— decaf, decaffeinated/.test(await rulesCard.innerText()), "rules explain themselves and show their words (starter rules incl. Decaf)");
  check((await rulesCard.locator("input[type=checkbox]:checked").count()) === 0, "starter rules are all off");
  await rulesCard.getByRole("button", { name: "+ Add a rule" }).click();
  await p.fill("#rn-label", "Peaberries");
  await p.fill("#rn-words", "peaberry, pea berry");
  await rulesCard.getByRole("button", { name: "Add rule" }).click();
  await p.locator('[data-testid="rule-my-peaberries"] input[type=checkbox]:checked').waitFor();
  let st = (await (await fetch(`${BASE}/api/setup`)).json()).settings;
  check(st.avoidRules.includes("my-peaberries") && st.ruleDefs.find((r) => r.id === "my-peaberries")?.keywords.join("|") === "peaberry|pea berry", "a new rule is saved with its words and switched on");
  await rulesCard.getByRole("button", { name: "Edit rule Cinnamon-forward coffees" }).click();
  await p.fill("#rw-cinnamon", "cinnamon, clove");
  await p.locator('[data-testid="rule-cinnamon"]').getByRole("button", { name: "Save" }).click();
  const edited = await p.locator('[data-testid="rule-cinnamon"] .rule-words', { hasText: "cinnamon, clove" }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(edited, "a starter rule's words can be edited");
  p.once("dialog", (d) => d.accept());
  await rulesCard.getByRole("button", { name: "Edit rule Blends" }).click();
  await p.locator('[data-testid="rule-blends"]').getByRole("button", { name: "Remove rule" }).click();
  await p.locator('[data-testid="rule-blends"]').waitFor({ state: "detached" });
  check(await rulesCard.getByRole("button", { name: /Restore starter rules you removed \(Blends\)/ }).isVisible(), "a removed starter rule can be restored");
  const dropped = await (await fetch(`${BASE}/api/discover/rules/check`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "pick", name: "Kenya Peaberry", roaster: "R", origin: "Kenya", processMethod: "Washed", tastingNotes: "blackcurrant", roastLevel: "Light", priceAmount: 20, priceText: "$20", url: "", whyFit: "", brewTip: "", funkRisk: "low" }) })).json();
  check(/peaberries/.test(dropped.dropped?.[0]?.reason ?? ""), `your rule leaves matching coffees out: ${dropped.dropped?.[0]?.reason}`);
  check(await p.getByRole("group", { name: "Flavours you love" }).getByRole("button", { name: "Apple & pear" }).isVisible(), "quiz covers more of the flavour wheel");

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
  await p.reload(); // the bag was created through the API — load it
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
