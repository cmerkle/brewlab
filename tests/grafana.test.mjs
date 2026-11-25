// The Grafana dashboard (grafana/brewlab-dashboard.json, built by scripts/grafana-dashboard.mjs)
// only queries metrics the app serves, and is valid enough to import.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-grafana-"));
process.env.DATA_DIR = tmp;
process.env.SEED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));
const { openDb } = await import("../dist/server/db.js");
const { collect } = await import("../dist/server/metrics.js");

test("every metric the dashboard queries exists in /metrics; panels have unique ids and fit the grid", () => {
  const dash = JSON.parse(fs.readFileSync(new URL("../grafana/brewlab-dashboard.json", import.meta.url), "utf8"));
  const served = new Set(collect(openDb(path.join(tmp, "brewlab.db"))).map((f) => f.name));
  const used = new Set();
  const panels = dash.panels.filter((p) => p.type !== "row" && p.type !== "canvas");
  const logo = dash.panels[0];
  assert.equal(logo.type, "canvas", "the Brewlab wordmark is first");
  // Grafana 12 reads a data URI as a file under /public/build, so the wordmark is loaded by URL from the repo.
  assert.match(logo.options.root.elements[0].config.path.fixed, /^https:\/\/cdn\.jsdelivr\.net\/gh\/cmerkle\/brewlab@main\/grafana\/brewlab-wordmark\.svg$/);
  const svg = fs.readFileSync(new URL("../grafana/brewlab-wordmark.svg", import.meta.url), "utf8");
  assert.match(svg, /\.theme-light \.blw-ink/, "the wordmark follows Grafana's light theme");
  for (const p of panels) for (const t of p.targets) for (const n of t.expr.match(/brewlab_[a-z0-9_]+/g) ?? []) used.add(n);
  const missing = [...used].filter((n) => !served.has(n));
  assert.deepEqual(missing, [], "metrics the dashboard uses but the app doesn't serve");
  assert.ok(used.size > 60, `the dashboard covers most metrics (${used.size} of ${served.size})`);
  const ids = dash.panels.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "panel ids are unique");
  for (const p of dash.panels) assert.ok(p.gridPos.x >= 0 && p.gridPos.x + p.gridPos.w <= 24, `${p.title} fits the 24-column grid`);
  assert.equal(dash.uid, "brewlab");
  assert.ok(dash.templating.list.some((v) => v.type === "datasource" && v.query === "prometheus"), "the data source is picked on import");
  for (const p of panels) assert.equal(p.datasource.uid, "${datasource}", `${p.title} uses the picked data source`);
});
