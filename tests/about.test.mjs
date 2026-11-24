// More → About: version, links, and the optional (off by default) update check.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-about-"));
process.env.DATA_DIR = tmp;
process.env.SEED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "brewlab-noseed-"));

const { createApp } = await import("../dist/server/app.js");
const { openDb } = await import("../dist/server/db.js");
const { compareVersions } = await import("../dist/shared/version.js");
const { dailyUpdateCheck } = await import("../dist/server/about.js");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("compareVersions orders releases and pre-releases", () => {
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("v0.10.0", "0.9.0") > 0);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  assert.ok(compareVersions("1.0.0", "1.0.0-beta.2") > 0);
  assert.ok(compareVersions("1.0.0-beta.10", "1.0.0-beta.2") > 0);
  assert.ok(compareVersions("1.0.0-alpha", "1.0.0-beta") < 0);
  assert.equal(compareVersions("nightly", "1.0.0"), 0); // unparseable → never "newer"
});

test("about: version from package.json, links, update check off and on", async () => {
  // A stand-in for GitHub's releases API.
  let answer = { status: 404, body: { message: "Not Found" } };
  let hits = 0;
  const gh = http.createServer((req, res) => {
    hits++;
    assert.match(req.headers["user-agent"], /^Brewlab\//);
    res.writeHead(answer.status, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
  });
  await new Promise((r) => gh.listen(0, "127.0.0.1", r));
  process.env.UPDATE_CHECK_URL = `http://127.0.0.1:${gh.address().port}/releases/latest`;

  const db = openDb(path.join(tmp, "about.db"));
  const { app } = createApp(db);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return res.json();
  };
  try {
    let a = await call("GET", "/api/about");
    assert.equal(a.version, pkg.version);
    assert.equal((await call("GET", "/api/health")).version, pkg.version);
    assert.match(a.links.bug, /\/issues\/new\?template=bug_report\.yml$/);
    assert.match(a.links.gear, /\/issues\/new\?template=gear\.yml$/);
    assert.equal(a.update.enabled, false);
    assert.equal(a.update.checkedAt, null);

    // Off by default: the daily check doesn't call out.
    assert.equal(await dailyUpdateCheck(db), null);
    assert.equal(hits, 0);

    // "Check now" with no releases yet.
    a = await call("POST", "/api/about/check");
    assert.equal(hits, 1);
    assert.deepEqual([a.update.latest, a.update.error, a.update.newer], [null, null, false]);

    // A newer release.
    answer = { status: 200, body: { tag_name: "v99.0.0", html_url: "https://github.com/example/brewlab/releases/tag/v99.0.0" } };
    a = await call("POST", "/api/about/check");
    assert.deepEqual([a.update.latest, a.update.newer, a.update.url], ["99.0.0", true, answer.body.html_url]);
    // The stored answer is what GET shows.
    assert.equal((await call("GET", "/api/about")).update.latest, "99.0.0");

    // The same version is not "newer"; a non-https link is dropped.
    answer = { status: 200, body: { tag_name: `v${pkg.version}`, html_url: "javascript:alert(1)" } };
    a = await call("POST", "/api/about/check");
    assert.deepEqual([a.update.newer, a.update.url], [false, null]);

    // Errors are reported, not thrown.
    answer = { status: 500, body: {} };
    a = await call("POST", "/api/about/check");
    assert.equal(a.update.error, "GitHub answered 500");

    // Switched on: the daily check runs, but at most once a day.
    await call("PUT", "/api/settings", { updateCheck: true });
    assert.equal((await call("GET", "/api/about")).update.enabled, true);
    const before = hits;
    assert.equal(await dailyUpdateCheck(db), null); // checked moments ago
    assert.equal(hits, before);
    db.prepare("UPDATE meta SET value=json_set(value, '$.checkedAt', '2000-01-01T00:00:00Z') WHERE key='updateCheck'").run();
    assert.ok(await dailyUpdateCheck(db));
    assert.equal(hits, before + 1);
  } finally {
    delete process.env.UPDATE_CHECK_URL;
    server.closeAllConnections(); server.close(); gh.close();
  }
});
