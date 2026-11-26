// The online demo (DEMO=1): every visitor gets a private, in-memory copy of the fictional demo data,
// thrown away after a while idle. Nothing a visitor does reaches another visitor, the disk or the
// internet: the endpoints that would (photo and link import, AI keys, backups, restore, the update
// check, metrics) answer 403. See docs/DEMO.md.
import express, { type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { openDb, type DB } from "./db.js";
import { apiApp, prepareDb, staticApp } from "./app.js";
import { DEMO_DIR } from "./routes-setup.js";
import { VERSION } from "./about.js";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const DEMO_IDLE_MIN = num(process.env.DEMO_IDLE_MIN, 60);
const MAX_SANDBOXES = num(process.env.DEMO_MAX_SANDBOXES, 300);
const NEW_PER_IP_PER_HOUR = num(process.env.DEMO_NEW_PER_IP, 30);
const COOKIE = "brewlab_demo";
const ID_RE = /^[A-Za-z0-9_-]{24}$/;

/** What the demo turns away: anything that writes outside the visitor's copy or calls out. */
const BLOCKED: [method: string, re: RegExp][] = [
  ["*", /^\/api\/import\//], // bag photos (shared disk, OCR), link import and AI lookup (outbound)
  ["*", /^\/api\/ai(\/|$)/], // the AI key lives in a shared file
  ["*", /^\/api\/backups(\/|$)/], // backup files are on the shared disk
  ["POST", /^\/api\/about\/check$/], // asks GitHub
  ["POST", /^\/api\/setup\/restore$/], // up to 50 MB into memory
  ["*", /^\/metrics$/],
  ["*", /^\/uploads\//],
];
export const blocked = (method: string, p: string) => BLOCKED.some(([m, re]) => (m === "*" || m === method) && re.test(p));

interface Sandbox { db: DB; app: express.Express; last: number }

/** Builds the starting database: the demo data, setup done, five months of history. */
async function buildTemplate(): Promise<Buffer> {
  const db = openDb(":memory:");
  prepareDb(db);
  const app = apiApp(db);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((ok) => server.once("listening", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (method: string, url: string, body?: unknown) => {
    const r = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
    return r.json();
  };
  try {
    await api("POST", "/api/setup/demo");
    await api("POST", "/api/setup/complete");
    const { addHistory } = await import(pathToFileURL(path.join(DEMO_DIR, "history.mjs")).href);
    const added = await addHistory(api);
    console.log(`[demo] template: demo data + ${added.bags} bags and ${added.brews} brews of history`);
  } finally {
    server.close();
  }
  const buf = db.serialize();
  db.close();
  return buf;
}

export async function demoApp() {
  let template = await buildTemplate();
  let templateDay = new Date().toDateString();
  const boxes = new Map<string, Sandbox>(); // insertion order = least recently used first
  const created = new Map<string, number[]>(); // ip → creation times in the last hour

  const open = (): Sandbox => {
    const db = new Database(template) as unknown as DB;
    db.pragma("foreign_keys = ON");
    return { db, app: apiApp(db), last: Date.now() };
  };
  const drop = (id: string) => {
    const b = boxes.get(id);
    if (!b) return;
    boxes.delete(id);
    try { b.db.close(); } catch { /* already closed */ }
  };

  // Idle sandboxes go; the template is rebuilt each day so the history always ends today.
  const sweep = setInterval(async () => {
    const cutoff = Date.now() - DEMO_IDLE_MIN * 60_000;
    for (const [id, b] of boxes) if (b.last < cutoff) drop(id);
    for (const [ip, ts] of created) {
      const recent = ts.filter((t) => t > Date.now() - 3_600_000);
      if (recent.length) created.set(ip, recent);
      else created.delete(ip);
    }
    if (new Date().toDateString() !== templateDay) {
      templateDay = new Date().toDateString();
      try { template = await buildTemplate(); } catch (e) { console.error("[demo] template rebuild failed:", e); }
    }
  }, 60_000);
  sweep.unref();

  const cookieId = (req: Request) => {
    const m = /(?:^|;\s*)brewlab_demo=([^;]+)/.exec(req.headers.cookie ?? "");
    return m && ID_RE.test(m[1]) ? m[1] : null;
  };
  const setCookie = (req: Request, res: Response, id: string) =>
    res.append("Set-Cookie", `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${req.secure ? "; Secure" : ""}`);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1)); // Fly/Render put one proxy in front

  // Monitors (no cookie) get a summary without making a copy; a visitor's own request goes to their copy.
  app.get("/api/health", (req, res, next) => {
    if (cookieId(req)) return next();
    res.json({ ok: true, demo: true, sandboxes: boxes.size, version: VERSION });
  });

  app.use((req, res, next) => {
    if (blocked(req.method, req.path)) {
      return res.status(403).json({ error: "Not available in the online demo. Install Brewlab to use this." });
    }
    next();
  });

  // Pages hand out the visitor's id (so the page's parallel API calls share one sandbox);
  // the sandbox itself is made on the first API call.
  app.use((req, res, next) => {
    let id = cookieId(req);
    if (!id) {
      id = crypto.randomBytes(18).toString("base64url");
      setCookie(req, res, id);
    }
    (req as Request & { demoId: string }).demoId = id;
    next();
  });

  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const id = (req as Request & { demoId: string }).demoId;
    let box = boxes.get(id);
    if (box) {
      boxes.delete(id); // move to the most recently used end
    } else {
      const ip = req.ip ?? "?";
      const ts = (created.get(ip) ?? []).filter((t) => t > Date.now() - 3_600_000);
      if (ts.length >= NEW_PER_IP_PER_HOUR) return res.status(429).json({ error: "Too many new demo sessions from here — try again later." });
      created.set(ip, [...ts, Date.now()]);
      while (boxes.size >= MAX_SANDBOXES) drop(boxes.keys().next().value as string);
      box = open();
    }
    box.last = Date.now();
    boxes.set(id, box);
    req.url = req.originalUrl; // the sandbox app mounts its routes under /api itself
    box.app(req, res, next);
  });

  const pub = staticApp();
  if (pub) app.use(pub);
  return { app, sandboxes: () => boxes.size, close: () => { clearInterval(sweep); for (const id of [...boxes.keys()]) drop(id); } };
}

export async function startDemoServer() {
  const { app } = await demoApp();
  const port = Number(process.env.PORT || 7642);
  const host = process.env.HOST || "0.0.0.0";
  app.listen(port, host, () =>
    console.log(`Brewlab ${VERSION} online demo on http://${host}:${port} — one private copy per visitor, dropped after ${DEMO_IDLE_MIN} min idle`));
}
