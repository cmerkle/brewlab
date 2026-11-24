import { chromium } from "playwright";
const [,, out] = process.argv;
const b = await chromium.launch();
const jobs = [["icon.svg","icon-512.png",512],["icon.svg","icon-192.png",192],["icon.svg","apple-touch-icon.png",180],["icon-maskable.svg","icon-maskable-512.png",512],["favicon.svg","favicon.png",64]];
for (const [src, name, n] of jobs) {
  const p = await b.newPage({ viewport: { width: n, height: n } });
  await p.goto("file:///tmp/claude-1000/-home-cjmerkle-brewlab/c95dff76-9f3d-43bc-bb13-b2f4db5f3275/scratchpad/logo/" + src);
  await p.evaluate((n) => { const s = document.querySelector("svg"); s.setAttribute("width", n); s.setAttribute("height", n); }, n);
  await p.screenshot({ path: out + "/" + name, clip: { x: 0, y: 0, width: n, height: n } });
  await p.close();
}
await b.close();
