// Fills a demo install with five months of fictional brewing for the README screenshots (Insights,
// Grafana). Never run it against a real install: it adds bags and brews through the API.
//   curl -XPOST $BASE/api/setup/demo && curl -XPOST $BASE/api/setup/complete
//   BASE=http://localhost:3104 node screenshot-data.mjs
// Deterministic (seeded), so the screenshots only change when the app does. All names are made up.

process.env.TZ = "UTC"; // brew times are UTC; screenshots.mjs renders in UTC too (the demo's own brews are 07:40Z / 08:05Z)
const BASE = process.env.BASE || "http://localhost:3104";
const api = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
};
if ((await api("GET", "/api/brews")).length > 10) { console.log("Already has history — nothing added."); process.exit(0); }

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const day = (offset) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - offset); return d; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Bags bought every ~12 days; each lasts a couple of weeks.
const BAGS = [
  ["Hillside Washed", "Example Roasters", "Ethiopia", "Washed", "Light", 24, ["jasmine", "lemon", "peach"]],
  ["Red Ridge AA", "Placeholder Beans", "Kenya", "Washed", "Light", 26, ["blackcurrant", "grapefruit"]],
  ["Valley Natural", "Sample Coffee Co.", "Ethiopia", "Natural", "Light", 22, ["strawberry", "cacao"]],
  ["Finca Demo", "Demo Coffee Lab", "Colombia", "Honey", "Medium-light", 20, ["caramel", "red apple"]],
  ["Morning Lot", "Example Roasters", "Rwanda", "Washed", "Light", 21, ["black tea", "orange"]],
  ["Cerrado Sample", "Sample Coffee Co.", "Brazil", "Natural", "Medium", 16, ["milk chocolate", "hazelnut"]],
  ["Highland Lot 4", "Placeholder Beans", "Guatemala", "Washed", "Medium", 19, ["brown sugar", "plum"]],
  ["Anaerobic Test", "Demo Coffee Lab", "Colombia", "Anaerobic", "Light", 28, ["tropical fruit", "rum"]],
];
const bags = [];
for (let i = 0; i < BAGS.length; i++) {
  const [name, roaster, origin, processMethod, roastLevel, price, tastingNotes] = BAGS[i];
  const bought = 150 - i * 19;
  const finished = i < BAGS.length - 2 ? bought - 18 : null;
  const bag = await api("POST", "/api/inventory", {
    name, roaster, origin, processMethod, roastLevel, price, tastingNotes, amountG: 340,
    roastDate: ymd(day(bought + 4)), purchaseDate: ymd(day(bought)), openedDate: ymd(day(bought - 1)),
    finishedDate: finished != null ? ymd(day(finished)) : null, rating: [4, 4.5, 3.5, 4, 5, 3, 4, null][i],
  });
  bags.push({ ...bag, from: bought - 1, to: finished ?? 0 });
}

const RECIPES = [
  { recipeId: 1001, recipeName: "Hoffmann V60", brewerId: "hario-v60-02", brewerName: "Hario V60 02", method: "pourover", doseG: 15, waterG: 250, w: 5 },
  { recipeId: 1002, recipeName: "Kasuya 4:6", brewerId: "hario-v60-02", brewerName: "Hario V60 02", method: "pourover", doseG: 20, waterG: 300, w: 2 },
  { recipeId: 1015, recipeName: "AeroPress Default", brewerId: "aeropress", brewerName: "AeroPress", method: "aeropress", doseG: 15, waterG: 230, w: 3 },
  { recipeId: 1018, recipeName: "French Press Default", brewerId: "french-press", brewerName: "French press", method: "immersion", doseG: 30, waterG: 500, w: 1 },
];
const weighted = RECIPES.flatMap((r) => Array(r.w).fill(r));
const GRINDERS = [["ode-gen2", "Fellow Ode Gen 2", 5], ["comandante-c40", "Comandante C40", 24], ["k-ultra", "1Zpresso K-Ultra", 7]];
const WATERS = [[2, "Third Wave Water Classic Light Roast"], [1, "Rao/Perger (Lotus drops)"], [null, null]];

let n = 0;
for (let off = 150; off >= 0; off--) {
  const d = day(off);
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const count = rnd() < 0.08 ? 0 : weekend ? (rnd() < 0.6 ? 2 : 1) : rnd() < 0.3 ? 2 : 1;
  for (let k = 0; k < count; k++) {
    const hour = k === 0 ? (weekend ? 8 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 2)) : 13 + Math.floor(rnd() * 3);
    const at = new Date(d); at.setHours(hour, Math.floor(rnd() * 60), 0, 0);
    if (at > new Date()) continue;
    const bag = bags.find((b) => off <= b.from && off >= b.to) ?? null;
    const r = pick(weighted);
    const [grinderId, grinderName, base] = r.method === "immersion" ? GRINDERS[0] : pick(GRINDERS);
    const [waterId, waterName] = pick(WATERS);
    const rating = rnd() < 0.15 ? null : Math.min(5, Math.max(2, Math.round((3.6 + rnd() * 1.6) * 2) / 2));
    await api("POST", "/api/brews", {
      ...r, w: undefined, grinderId, grinderName, grindSetting: Math.round((base + (rnd() - 0.5) * base * 0.1) * 10) / 10,
      inventoryId: bag?.id ?? null, coffee: bag?.name ?? null, tempC: r.method === "immersion" ? 94 : 96, totalTimeSec: 150 + Math.floor(rnd() * 60),
      rating, waterId, waterName, brewedAt: at.toISOString(),
    });
    n++;
  }
}
console.log(`Added ${bags.length} bags and ${n} brews.`);
