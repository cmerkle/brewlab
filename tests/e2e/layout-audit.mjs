// Layout audit: every page, tab and dialog at standard iPhone sizes and both iPhone Duo screens,
// portrait + landscape. Flags horizontal overflow, elements past the screen edge, overlapping
// siblings in rows, text spilling out of its box, content hidden behind the bottom tab bar,
// and dialogs that don't exactly fill the screen.
//
// Usage: BASE=http://localhost:3100 node layout-audit.mjs   (read-mostly; run on a throwaway instance)
// Viewports for the iPhone Duo are the widely-quoted estimates (panel pixels ÷ 3x); verify on device.
import { chromium, webkit } from "playwright";
// BROWSER=webkit runs the same audit on WebKit (Safari's engine), e.g. inside the Playwright Docker image.
const ENGINE = process.env.BROWSER === "webkit" ? webkit : chromium;
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3100";
const SHOTS = process.env.SHOTS || "";
// Layout is measured in CSS px, so pixel density doesn't change results; DPR=1 keeps memory low.
const DPR = Number(process.env.DPR || 1);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null; // e.g. ONLY=Duo
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

const VIEWPORTS = [
  ["iPhone SE", 375, 667], ["iPhone (6.1\")", 390, 844], ["iPhone Pro Max", 430, 932],
  ["Duo outer", 466, 678], ["Duo inner", 626, 890], ["Duo inner Split View", 313, 890],
  // Real-device screenshots showed the Duo's inner screen is wider than the 626/890 estimate in
  // landscape (it reached the ≥900px layout), so also cover a larger foldable.
  ["Large foldable", 700, 1000],
].flatMap(([name, w, h]) => [
  { name: `${name} portrait`, w, h, touch: true },
  { name: `${name} landscape`, w: name === "Duo inner Split View" ? 445 : h, h: name === "Duo inner Split View" ? 626 : w, touch: true },
]).concat([{ name: "Desktop (mouse)", w: 1280, h: 800, touch: false }]);

const PAGES = [
  { name: "Recipes", hash: "brew/recipes" },
  { name: "Recipes (row expanded)", hash: "brew/recipes", act: async (p) => p.locator('[data-testid="recipe-1001"] [data-testid="recipe-toggle"]').click() },
  { name: "Guide", hash: "brew/guide" },
  { name: "Stash", hash: "brew/stash" },
  { name: "Stash ⋯ menu", hash: "brew/stash", act: async (p) => p.locator('[data-testid="bag-1"] .menu .icon-btn').click() },
  { name: "Brew Log", hash: "brew/log" },
  { name: "Gear", hash: "brew/gear" },
  { name: "Water", hash: "brew/water" },
  { name: "Discover board", hash: "discover/board" },
  { name: "Past editions", hash: "discover/archive" },
  { name: "Tasting log", hash: "discover/tastings" },
  { name: "Avoid list", hash: "discover/avoid" },
  { name: "Refresh", hash: "discover/refresh" },
  { name: "Your taste", hash: "discover/taste" },
  { name: "Your taste (editing a rule)", hash: "discover/taste", act: async (p) => { await p.getByRole("button", { name: "Edit rule Cinnamon-forward coffees" }).click(); await p.getByRole("button", { name: "+ Add a rule" }).click(); } },
  { name: "Your taste (research prompt open)", hash: "discover/taste", act: async (p) => p.getByRole("button", { name: /Show what the weekly research is told/ }).click() },
  { name: "More", hash: "more" },
  { name: "dialog: Brew setup", hash: "brew/recipes", dialog: true, act: async (p) => p.locator('[data-testid="recipe-1001"] [data-testid="recipe-brew"]').click() },
  { name: "dialog: Timer", hash: "brew/recipes", dialog: true, act: async (p) => { await p.locator('[data-testid="recipe-1001"] [data-testid="recipe-brew"]').click(); await p.getByRole("button", { name: "Ready to brew" }).click(); await p.waitForTimeout(300); } },
  { name: "dialog: Timer running", hash: "brew/recipes", dialog: true, act: async (p) => { await p.locator('[data-testid="recipe-1001"] [data-testid="recipe-brew"]').click(); await p.getByRole("button", { name: "Ready to brew" }).click(); await p.getByRole("button", { name: "Start timer" }).click(); await p.waitForTimeout(300); } },
  { name: "dialog: Save to Brew Log", hash: "brew/recipes", dialog: true, act: async (p) => { await p.locator('[data-testid="recipe-1001"] [data-testid="recipe-brew"]').click(); await p.getByRole("button", { name: "Ready to brew" }).click(); await p.getByRole("button", { name: "Start timer" }).click(); await p.getByRole("button", { name: "Finish" }).click(); } },
  { name: "dialog: Ratio calculator", hash: "more", dialog: true, act: async (p) => p.getByRole("button", { name: /Ratio calculator/ }).click() },
  { name: "dialog: Recipe editor", hash: "brew/recipes", dialog: true, act: async (p) => { await p.locator('[data-testid="recipe-1001"] [data-testid="recipe-toggle"]').click(); await p.locator('[data-testid="recipe-1001"]').getByRole("button", { name: "Edit" }).click(); } },
  { name: "dialog: Add a bag", hash: "brew/stash", dialog: true, act: async (p) => p.getByRole("button", { name: "Add a bag" }).click() },
  { name: "dialog: Duplicate bag", hash: "brew/stash", dialog: true, act: async (p) => { await p.locator('[data-testid="bag-1"] .menu .icon-btn').click(); await p.getByRole("menuitem", { name: "Duplicate" }).click(); await p.locator('[data-testid="bag-copy-note"]').waitFor(); } },
  { name: "dialog: Finish bag", hash: "brew/stash", dialog: true, act: async (p) => p.locator('[data-testid="bag-1"]').getByRole("button", { name: "Mark finished" }).click() },
  { name: "dialog: Brew log form", hash: "brew/log", dialog: true, act: async (p) => p.locator('[data-testid="brew-1"]').getByRole("button", { name: "Edit" }).click() },
  { name: "dialog: Gear editor", hash: "brew/gear", dialog: true, act: async (p) => p.locator('[data-testid="gear-ode-gen2"]').getByRole("button", { name: "Edit" }).click() },
  // First-run setup (re-run from Settings on the seeded data; finished again afterwards).
  ...[
    ["Welcome", 0], ["Brewers", 1], ["Grinders", 2], ["Preferences", 3], ["Starter recipes", 4], ["Discover", 5],
  ].map(([n, k]) => ({
    name: `setup: ${n}`, hash: "brew/recipes", setup: true,
    act: async (p) => {
      if (k > 0) await p.getByRole("button", { name: "Start" }).click();
      for (let i = 1; i < k; i++) await p.locator(".setup-nav").getByRole("button").first().click();
      await p.waitForFunction((want) => document.querySelector('[data-testid="setup"]')?.getAttribute("data-step") === want, n);
      await p.waitForLoadState("networkidle");
    },
  })),
  { name: "setup: custom grinder + calibration", hash: "brew/recipes", setup: true, act: async (p) => {
    await p.getByRole("button", { name: "Start" }).click();
    await p.locator(".setup-nav").getByRole("button").first().click();
    await p.getByRole("button", { name: /add your own grinder/i }).click();
    await p.fill("#cg-v60", "25");
    await p.locator('[data-testid="calibration"]').waitFor();
  } },
  { name: "dialog: Suggest to the library", hash: "brew/gear", dialog: true, act: async (p) => { await p.locator('[data-testid="gear-ode-gen2"]').getByRole("button", { name: "Edit" }).click(); await p.locator('[data-testid="suggest-open"]').click(); await p.locator('[data-testid="suggest-json"]').waitFor(); } },
  { name: "dialog: Gear library", hash: "brew/gear", dialog: true, act: async (p) => { await p.getByRole("button", { name: "Add gear" }).click(); await p.locator('[data-testid="gear-library"] li').first().waitFor(); } },
  { name: "dialog: Water library", hash: "brew/water", dialog: true, act: async (p) => { await p.getByRole("button", { name: "Add water" }).click(); await p.locator('[data-testid^="water-lib-"]').first().waitFor(); } },
  { name: "dialog: Water editor", hash: "brew/water", dialog: true, act: async (p) => { await p.locator('[data-testid="water-1"]').getByRole("button", { name: "Edit" }).click(); await p.locator('[data-testid="water-form"]').waitFor(); await p.getByRole("button", { name: "+ Add an additive" }).click(); await p.selectOption("#wr-add-4", "__custom"); await p.selectOption("#wr-base", "tap"); } },
];

function auditInPage({ isDialog, deviceW, deviceH }) {
  // Measure against the DEVICE size: on mobile browsers a too-wide element silently grows the
  // layout viewport (the page zooms out) instead of scrolling, so innerWidth can't be trusted.
  const vw = deviceW, vh = deviceH;
  const issues = [];
  if (window.innerWidth > deviceW + 1) issues.push(`layout viewport grew to ${window.innerWidth}px on a ${deviceW}px screen (page would zoom out)`);
  const desc = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const txt = (el.innerText || el.value || el.getAttribute?.("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30);
    return `<${el.tagName.toLowerCase()}${id}${cls}>${txt ? ` "${txt}"` : ""}`;
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clipped = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (["auto", "scroll", "hidden", "clip"].includes(s.overflowX) && a !== document.body && a !== document.documentElement) return a;
    }
    return null;
  };
  const scope = isDialog ? document.querySelector('[role="dialog"]') : document.body;
  // 1. horizontal page overflow
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) issues.push(`page scrolls horizontally (scrollWidth ${sw} > ${vw})`);
  const els = [...scope.querySelectorAll("*")].filter(visible);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    // 2. past the screen edge (unless inside a scroll/clip container, e.g. the Discover tab strip)
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) issues.push(`off-screen ${Math.round(r.left)}..${Math.round(r.right)}: ${desc(el)}`);
    // 3. text spilling out of its own box
    const cs = getComputedStyle(el);
    if (el.children.length === 0 && el.textContent.trim() && cs.overflowX === "visible" && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && !["INPUT", "TEXTAREA", "SELECT", "svg", "path", "OPTION"].includes(el.tagName))
      issues.push(`text overflows its box (${el.scrollWidth}>${el.clientWidth}): ${desc(el)}`);
    // 4. overlapping siblings in a row
    if (cs.display.includes("flex") || cs.display.includes("grid")) {
      const kids = [...el.children].filter((k) => visible(k) && !["absolute", "fixed"].includes(getComputedStyle(k).position));
      for (let i = 0; i < kids.length; i++)
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) issues.push(`overlap ${Math.round(ox)}×${Math.round(oy)}px: ${desc(kids[i])} ⟷ ${desc(kids[j])}`);
        }
    }
  }
  // 5. dialogs fill the screen; header & footer controls fully visible
  if (isDialog) {
    const d = scope.getBoundingClientRect();
    if (Math.abs(d.left) > 1 || Math.abs(d.top) > 1 || Math.abs(d.width - vw) > 1 || Math.abs(d.height - vh) > 1)
      issues.push(`dialog doesn't fill the screen: ${Math.round(d.width)}×${Math.round(d.height)} @${Math.round(d.left)},${Math.round(d.top)}`);
    // Dialogs must live directly under <body>: iOS WebKit confines a position:fixed overlay that
    // sits inside a scrolling container to that container (the dialog then hides under the header).
    if (scope.parentElement !== document.body) issues.push(`dialog is nested inside <${scope.parentElement?.tagName.toLowerCase()}${scope.parentElement?.className ? "." + String(scope.parentElement.className).split(" ")[0] : ""}>, not directly under <body>`);
    for (let a = scope.parentElement; a && a !== document.body; a = a.parentElement) {
      const ov = getComputedStyle(a).overflowY;
      if (ov === "auto" || ov === "scroll") { issues.push(`dialog is inside a scrolling container <${a.tagName.toLowerCase()}>`); break; }
    }
    // Every dialog needs a reachable way back: a Back button on the left of its header.
    const back = scope.querySelector(".fs-head .back-btn");
    if (!back) issues.push("dialog has no Back button");
    else {
      const r = back.getBoundingClientRect();
      if (r.left < 0 || r.top < 0 || r.right > vw / 2 || r.bottom > vh) issues.push(`Back button not reachable at the top-left (${Math.round(r.left)},${Math.round(r.top)})`);
    }
    for (const b of scope.querySelectorAll(".fs-head button, .fs-foot button")) {
      const r = b.getBoundingClientRect();
      if (r.top < 0 || r.bottom > vh + 1 || r.left < 0 || r.right > vw + 1) issues.push(`dialog control not fully visible: ${desc(b)}`);
      if (r.height < 36) issues.push(`small tap target (${Math.round(r.height)}px): ${desc(b)}`);
    }
    const body = scope.querySelector(".fs-body")?.getBoundingClientRect();
    if (body && body.height < 120) issues.push(`dialog content area only ${Math.round(body.height)}px tall`);
  }
  return [...new Set(issues)];
}

async function navChecks(p, v) {
  // 6. Touch layout: the tab bar sits flush with the bottom of the screen, its items are centred,
  //    and the end of the content can scroll clear of it. Desktop: the nav is in the top bar.
  return p.evaluate(async ({ vw, vh, touch }) => {
    const issues = [];
    const tabbar = document.documentElement.classList.contains("tabbar");
    if (tabbar !== touch) issues.push(`wrong layout: ${tabbar ? "tab bar" : "top nav"} on a ${touch ? "touch" : "desktop"} screen`);
    const want = { "#/brew/recipes": ["Ratio calculator", "New recipe"], "#/brew/stash": ["Add a bag"], "#/brew/log": ["Log a brew manually"], "#/brew/gear": ["Add gear"] }[location.hash] ?? [];
    for (const label of want)
      if (!document.querySelector(`.head-actions button[aria-label="${label}"]`)) issues.push(`title-bar button "${label}" missing`);
    const nav = document.querySelector(".nav");
    if (!nav) return [...issues, "no main nav"];
    const r = nav.getBoundingClientRect();
    if (!tabbar) {
      if (r.top > 80) issues.push(`desktop nav not in the top bar (top ${Math.round(r.top)})`);
      return issues;
    }
    if (Math.abs(r.bottom - vh) > 1) issues.push(`tab bar not at the bottom of the screen (bottom ${Math.round(r.bottom)} vs ${vh})`);
    if (Math.abs(r.left) > 1 || Math.abs(r.right - vw) > 1) issues.push(`tab bar doesn't span the screen (${Math.round(r.left)}..${Math.round(r.right)})`);
    const items = [...nav.querySelectorAll("a")].filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getBoundingClientRect());
    const mid = (Math.min(...items.map((i) => i.left)) + Math.max(...items.map((i) => i.right))) / 2;
    if (Math.abs(mid - vw / 2) > 2) issues.push(`tab bar items off-centre by ${Math.round(mid - vw / 2)}px`);
    const main = document.querySelector("main");
    main.scrollTop = main.scrollHeight;
    await new Promise((res) => setTimeout(res, 80));
    const all = [...main.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().height > 0);
    const lowest = Math.max(...all.map((e) => e.getBoundingClientRect().bottom));
    if (lowest > r.top + 1) issues.push(`last content (${Math.round(lowest)}) can't scroll clear of the tab bar (${Math.round(r.top)})`);
    main.scrollTop = 0;
    return issues;
  }, { vw: v.w, vh: v.h, touch: v.touch });
}

const browser = await ENGINE.launch();
const report = [];
let total = 0;
for (const v of VIEWPORTS.filter((x) => !ONLY || ONLY.test(x.name))) {
  const ctx = await browser.newContext(
    v.touch
      ? { viewport: { width: v.w, height: v.h }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, userAgent: IOS_UA }
      : { viewport: { width: v.w, height: v.h }, deviceScaleFactor: DPR },
  );
  const errs = [];
  for (const pg of PAGES) {
    // A fresh tab per screen keeps memory flat across the run.
    const p = await ctx.newPage();
    p.on("dialog", (d) => d.dismiss().catch(() => {}));
    p.on("pageerror", (e) => errs.push(e.message));
    // A running brew left by an earlier screen would reopen its timer over this one. Clear it
    // before the app's scripts run: clearing after load races the timer, which re-saves itself
    // when the page is hidden (that's how a brew survives iOS killing the app).
    await p.addInitScript(() => {
      try {
        localStorage.removeItem("brewlab.activeBrew");
      } catch {}
    });
    await p.goto(`${BASE}/#/${pg.hash}`);
    if (pg.setup) await p.evaluate(() => fetch("/api/setup/restart", { method: "POST" }));
    await p.reload();
    await p.waitForLoadState("networkidle");
    let issues = [];
    try {
      if (pg.act) await pg.act(p);
      await p.waitForTimeout(200);
      issues = await p.evaluate(auditInPage, { isDialog: !!pg.dialog, deviceW: v.w, deviceH: v.h });
      if (!pg.dialog && !pg.setup) issues.push(...(await navChecks(p, v)));
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.screenshot({ path: `${SHOTS}/${v.name.replace(/[^\w]+/g, "_")}--${pg.name.replace(/[^\w]+/g, "_")}.png` });
      }
    } catch (e) {
      issues.push(`could not open: ${e.message.split("\n")[0]}`);
    }
    if (pg.setup) await p.evaluate(() => fetch("/api/setup/complete", { method: "POST" }));
    total++;
    if (issues.length) report.push({ viewport: `${v.name} ${v.w}×${v.h}`, page: pg.name, issues });
    await p.close();
  }
  if (errs.length) report.push({ viewport: `${v.name} ${v.w}×${v.h}`, page: "(page errors)", issues: errs });
  await ctx.close();
}
if (!ONLY || ONLY.test("fold")) {
  // 7. Fold / unfold / rotate on a live page: the tab bar must follow the new screen every time.
  const ctx = await browser.newContext({ viewport: { width: 466, height: 678 }, isMobile: true, hasTouch: true, userAgent: IOS_UA });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/#/brew/recipes`);
  await p.waitForLoadState("networkidle");
  const seq = [[626, 890], [890, 626], [678, 466], [466, 678], [1000, 700], [466, 678], [700, 1000]];
  for (const [w, h] of seq) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(400);
    const issues = await navChecks(p, { w, h, touch: true });
    total++;
    if (issues.length) report.push({ viewport: `fold/rotate → ${w}×${h}`, page: "Recipes (live resize)", issues });
  }
  await ctx.close();
}
await browser.close();
console.log(`Audited ${total} page/viewport combinations.`);
if (!report.length) console.log("No layout issues found.");
for (const r of report) {
  console.log(`\n✗ ${r.viewport} — ${r.page}`);
  for (const i of r.issues.slice(0, 8)) console.log(`   • ${i}`);
  if (r.issues.length > 8) console.log(`   … ${r.issues.length - 8} more`);
}
process.exit(report.length ? 1 : 0);
