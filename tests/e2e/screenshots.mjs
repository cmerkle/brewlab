// README screenshots, from an install with the (fictional) demo data:
//   curl -XPOST $BASE/api/setup/demo && curl -XPOST $BASE/api/setup/complete
//   BASE=http://localhost:3104 node screenshots.mjs        → docs/screenshots/*.png
// Each phone shot is taken in light and dark mode; the README picks one with <picture>.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:3104";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/screenshots");
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" };

const shots = {
  async recipes(p) {
    await p.goto(`${BASE}/#/brew/recipes`);
    await p.getByTestId("recipe-toggle").first().click();
  },
  async timer(p) {
    await p.goto(`${BASE}/#/brew/recipes`);
    // A pour-over recipe: more steps on screen than an AeroPress.
    await p.locator(".card", { has: p.getByText("Hoffmann V60", { exact: false }) }).getByTestId("recipe-brew").first().click();
    await p.getByRole("button", { name: "Ready to brew" }).click();
    await p.getByRole("button", { name: "Start timer" }).click();
    await p.waitForTimeout(16500);
  },
  async guide(p) {
    await p.goto(`${BASE}/#/brew/guide`);
    await p.getByTestId("converter-results").waitFor();
  },
  async discover(p) {
    await p.goto(`${BASE}/#/discover/board`);
  },
  async stash(p) {
    await p.goto(`${BASE}/#/brew/stash`);
  },
};

const b = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  for (const [name, go] of Object.entries(shots)) {
    const ctx = await b.newContext({ ...PHONE, colorScheme: scheme });
    const p = await ctx.newPage();
    await go(p);
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${OUT}/${name}-${scheme}.png` });
    console.log(`✓ ${name}-${scheme}`);
    await ctx.close();
  }
}
await b.close();
// Shrink: 256-colour palette PNGs are about a third of the size and look the same at phone scale.
import { execFileSync } from "node:child_process";
try {
  execFileSync("python3", ["-c", `import sys,glob
from PIL import Image
for f in glob.glob(sys.argv[1] + "/*.png"):
    Image.open(f).convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(f, optimize=True)`, OUT]);
  console.log("✓ shrunk");
} catch { console.log("(Pillow not found — PNGs left full size)"); }
