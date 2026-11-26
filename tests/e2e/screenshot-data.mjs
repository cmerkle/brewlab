// Fills a demo install with five months of fictional brewing for the README screenshots (Insights,
// Grafana). Never run it against a real install: it adds bags and brews through the API.
//   curl -XPOST $BASE/api/setup/demo && curl -XPOST $BASE/api/setup/complete
//   BASE=http://localhost:3104 node screenshot-data.mjs
// Deterministic (seeded), so the screenshots only change when the app does. All names are made up.

import { addHistory } from "../../demo/history.mjs";

process.env.TZ = "UTC"; // brew times are UTC; screenshots.mjs renders in UTC too (the demo's own brews are 07:40Z / 08:05Z)
const BASE = process.env.BASE || "http://localhost:3104";
const api = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
};
if ((await api("GET", "/api/brews")).length > 10) { console.log("Already has history — nothing added."); process.exit(0); }

const r = await addHistory(api);
console.log(`Added ${r.bags} bags and ${r.brews} brews.`);
