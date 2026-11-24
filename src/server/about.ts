// About: this install's version, the project's links, and the optional update check.
// The update check is off by default (settings.updateCheck). When on, Brewlab asks GitHub's
// public API for the repo's latest release once a day; nothing about the install is sent.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import type { DB } from "./db.js";
import { LIBRARY_REPO } from "./catalog.js";
import { getSettings } from "./settings.js";
import { compareVersions, parseVersion } from "../shared/version.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  // dist/server/about.js (or src/server/about.ts) → package.json two levels up
  for (const p of [path.join(here, "..", "..", "package.json"), path.join(process.cwd(), "package.json")]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (pkg.name === "brewlab" && typeof pkg.version === "string") return pkg.version;
    } catch {
      /* try the next one */
    }
  }
  return "unknown";
}
export const VERSION = readVersion();

export interface UpdateStatus {
  checkedAt: string;
  /** Latest release's version ("0.2.0"), null if the repo has no releases yet. */
  latest: string | null;
  url: string | null;
  error: string | null;
}

const META_KEY = "updateCheck";
const DAY = 24 * 3600 * 1000;

export function lastUpdateStatus(db: DB): UpdateStatus | null {
  const row = db.prepare("SELECT value FROM meta WHERE key=?").get(META_KEY) as { value: string } | undefined;
  try {
    return row ? (JSON.parse(row.value) as UpdateStatus) : null;
  } catch {
    return null;
  }
}

type Fetch = typeof fetch;

/** Asks GitHub for the latest release and stores the answer. Never throws. */
export async function checkForUpdate(db: DB, fetchImpl: Fetch = fetch): Promise<UpdateStatus> {
  const url = process.env.UPDATE_CHECK_URL || `https://api.github.com/repos/${LIBRARY_REPO}/releases/latest`;
  let st: UpdateStatus = { checkedAt: new Date().toISOString(), latest: null, url: null, error: null };
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Brewlab/${VERSION}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) st.error = null; // no releases published yet
    else if (!res.ok) st.error = `GitHub answered ${res.status}`;
    else {
      const j = (await res.json()) as { tag_name?: string; html_url?: string };
      const v = parseVersion(j.tag_name);
      if (!v) st.error = "The latest release has no version number";
      else {
        st.latest = String(j.tag_name).replace(/^v/, "");
        st.url = typeof j.html_url === "string" && j.html_url.startsWith("https://") ? j.html_url : null;
      }
    }
  } catch (e: any) {
    st.error = e?.name === "TimeoutError" ? "GitHub didn't answer in time" : "Couldn't reach GitHub";
  }
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(META_KEY, JSON.stringify(st));
  return st;
}

/** The daily check (cron): only when switched on, and at most once a day. */
export async function dailyUpdateCheck(db: DB): Promise<UpdateStatus | null> {
  if (!getSettings(db).updateCheck) return null;
  const last = lastUpdateStatus(db);
  if (last && Date.now() - Date.parse(last.checkedAt) < DAY - 3600 * 1000) return null;
  return checkForUpdate(db);
}

export function aboutInfo(db: DB) {
  const repo = `https://github.com/${LIBRARY_REPO}`;
  const st = lastUpdateStatus(db);
  return {
    version: VERSION,
    repo,
    links: {
      releases: `${repo}/releases`,
      bug: `${repo}/issues/new?template=bug_report.yml`,
      gear: `${repo}/issues/new?template=gear.yml`,
      contributing: `${repo}/blob/main/CONTRIBUTING.md`,
    },
    update: {
      enabled: getSettings(db).updateCheck,
      ...(st ?? { checkedAt: null, latest: null, url: null, error: null }),
      newer: !!(st?.latest && compareVersions(st.latest, VERSION) > 0),
    },
  };
}

export function aboutRouter(db: DB, fetchImpl?: Fetch) {
  const r = Router();
  r.get("/about", (_req, res) => res.json(aboutInfo(db)));
  // "Check now": an explicit tap, so it runs whether or not the daily check is on.
  r.post("/about/check", async (_req, res) => {
    await checkForUpdate(db, fetchImpl);
    res.json(aboutInfo(db));
  });
  return r;
}
