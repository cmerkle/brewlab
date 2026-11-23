// "Import the details". Both paths only return a DRAFT; nothing is saved.
// Never invent a field the source does not state — leave it blank.
import * as cheerio from "cheerio";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dns from "node:dns/promises";
import net from "node:net";
import { llmEnabled, readLabelWithVision } from "./llm.js";

const execFileP = promisify(execFile);

export interface BagDraft {
  name?: string;
  roaster?: string;
  origin?: string;
  processMethod?: string;
  roastLevel?: string;
  roastDate?: string;
  amountG?: number;
  price?: number;
  tastingNotes?: string;
  /** Stated details with no dedicated field (region, producer, variety, altitude) → notes. */
  details?: string;
  url?: string;
}

export type ImportResult =
  | { found: true; draft: BagDraft; fields: string[]; source: string; message: string; rawText?: string }
  | { found: false; message: string; source: string; rawText?: string };

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const clean = (s: unknown) =>
  typeof s === "string" ? s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() : "";

const PROCESS_RE = /\b(washed|natural|honey|anaerobic|wet[- ]hulled|semi[- ]washed|pulped natural|carbonic maceration|thermal shock|double fermentation|co-?ferment(?:ed)?|experimental)\b/i;
const ROAST_RE = /\b(extra[- ]light|light[- ]medium|medium[- ]light|medium[- ]dark|light|medium|dark)\s*(?:\/\s*(?:light|medium|dark))?\s*roast\b|\broast(?:\s*level)?\s*[:\-–]\s*([a-z /-]{3,30})/i;

const ORIGINS = [
  "Ethiopia", "Kenya", "Colombia", "Brazil", "Guatemala", "Honduras", "Costa Rica", "El Salvador", "Nicaragua", "Panama",
  "Peru", "Bolivia", "Ecuador", "Mexico", "Rwanda", "Burundi", "Uganda", "Tanzania", "Congo", "DRC", "Yemen", "Indonesia",
  "Sumatra", "Java", "Sulawesi", "Papua New Guinea", "India", "Vietnam", "China", "Yunnan", "Thailand", "Myanmar",
  "Timor", "Jamaica", "Hawaii", "Kona", "Malawi", "Zambia", "Zimbabwe", "Taiwan", "Philippines", "Laos",
];

function findOrigins(text: string): string {
  const found = ORIGINS.filter((o) => new RegExp(`\\b${o}\\b`, "i").test(text));
  return [...new Set(found)].slice(0, 3).join(" · ");
}

/** Bag size in grams from text like "12 oz", "340g", "1 lb", "250 g". */
export function findBagSize(text: string): number | undefined {
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*(oz|ounces?|g|grams?|kg|lb|lbs|pounds?)\b/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  if (u.startsWith("oz") || u.startsWith("ounce")) return Math.round(n * 28.3495);
  if (u === "kg") return Math.round(n * 1000);
  if (u.startsWith("lb") || u.startsWith("pound")) return Math.round(n * 453.592);
  return Math.round(n);
}

function labelled(text: string, labels: string[], nextLine = true): string {
  const tidy = (v: string) => v.replace(/\s+/g, " ").trim().replace(/[.;,]$/, "");
  for (const l of labels) {
    // "Origin: Kenya" — value runs to the end of its sentence (". "), a pipe/bullet, or the line
    // end, so one-paragraph descriptions ("Origin: Kenya. Process: Washed.") split correctly.
    const m = text.match(new RegExp(`(?:^|\\n|\\s)${l}\\s*[:\\-–]\\s*([^\\n|•]{2,120}?)(?=\\.\\s|\\.?$|\\n|\\s*[|•])`, "im"));
    if (m) return tidy(m[1]);
  }
  if (!nextLine) return "";
  for (const l of labels) {
    // Label alone on its line and the value on the next — separate elements, <dt>/<dd>,
    // table cells or accordion headings ("ORIGIN\nCosta Rica").
    const m = text.match(new RegExp(`(?:^|\\n)[ \\t]*${l}[ \\t]*:?[ \\t]*\\n[ \\t]*([^\\n]{2,120})`, "im"));
    if (m && !/:\s*$/.test(m[1])) return tidy(m[1]);
  }
  return "";
}

/** Label spellings roasters use, per field. Order matters: specific before generic. */
const LABELS = {
  origin: ["country of origin", "origin", "country"],
  region: ["growing region", "region"],
  farm: ["washing station", "farm", "estate", "producers?", "farmer", "mill"],
  variety: ["varietals?", "varieties", "variety", "cultivars?"],
  altitude: ["altitude", "elevation"],
  process: ["processing method", "process method", "processing", "process"],
  tasting: ["tasting notes", "cupping notes", "cup notes", "flavou?r notes", "flavou?r profile", "tastes like", "we taste", "in the cup", "cup profile", "notes"],
  roast: ["roast level", "roast profile", "roast"],
  size: ["bag size", "net weight", "net wt", "weight", "size"],
};

/** Every field the text states, by label (plus process/roast keywords as a fallback). */
/** `productContext`: the text is known to describe a product (Shopify data or a page marked up
    as a product), so looser "label on one line, value on the next" layouts are trusted. On any
    other page only explicit "Label: value" counts — a Wikipedia infobox must not fill the form. */
function fieldsFromText(text: string, desc = "", productContext = true) {
  const L = (labels: string[]) => labelled(text, labels, productContext);
  const roastM = text.match(ROAST_RE);
  const roastLbl = L(LABELS.roast);
  return {
    origin: L(LABELS.origin),
    region: L(LABELS.region),
    farm: L(LABELS.farm),
    variety: L(LABELS.variety),
    altitude: L(LABELS.altitude),
    process: L(LABELS.process) || (desc.match(PROCESS_RE)?.[0] ?? ""),
    tasting: L(LABELS.tasting),
    roast: (roastLbl || (roastM ? (roastM[1] || roastM[2] || "") : "")).replace(/\s*roast$/i, "").trim(),
    sizeText: L(LABELS.size),
  };
}

/** Stated details without a dedicated bag field go into the notes (never invented). */
function detailsLine(f: { region?: string; farm?: string; variety?: string; altitude?: string }) {
  return [
    f.region && `Region: ${f.region}`,
    f.farm && `Producer: ${f.farm}`,
    f.variety && `Variety: ${f.variety}`,
    f.altitude && `Altitude: ${f.altitude}`,
  ].filter(Boolean).join(" · ");
}

/** HTML → text with block elements on their own lines. */
function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  $("p, div, li, h1, h2, h3, h4, h5, h6, tr, td, th, dt, dd, section, article, summary, details").append("\n");
  $("br").replaceWith("\n");
  return $.root().text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
}

function finalize(draft: BagDraft, source: string, rawText?: string, coffeeEvidence = true): ImportResult {
  const d: BagDraft = {};
  for (const [k, v] of Object.entries(draft)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    (d as any)[k] = typeof v === "string" ? v.trim() : v;
  }
  const fields = Object.keys(d).filter((k) => k !== "url");
  if (!coffeeEvidence || fields.length === 0) {
    return {
      found: false,
      source,
      rawText,
      message: source === "link" ? "No coffee details were found on that page." : "Couldn't read any coffee details from that photo.",
    };
  }
  return { found: true, draft: d, fields, source, rawText, message: `Filled ${fields.length} field${fields.length === 1 ? "" : "s"} — check them before saving.` };
}

/* ------------------------------ Roaster link ------------------------------ */

function jsonLdProducts($: cheerio.CheerioAPI): any[] {
  const out: any[] = [];
  const visit = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    const t = n["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product")) || t === "ProductGroup") out.push(n);
    if (n["@graph"]) visit(n["@graph"]);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).contents().text()));
    } catch {
      /* ignore malformed blocks */
    }
  });
  return out;
}

export function extractFromHtml(html: string, url: string): ImportResult {
  const $ = cheerio.load(html);
  const meta = (k: string) => $(`meta[property="${k}"]`).attr("content") || $(`meta[name="${k}"]`).attr("content") || "";
  const products = jsonLdProducts($);
  const p = products[0];
  const ogType = meta("og:type").toLowerCase();
  const isProduct = Boolean(p) || ogType.includes("product") || Boolean(meta("product:price:amount"));

  // Page text (second priority) — description blocks and visible body text.
  $("script, style, noscript, svg, nav, footer, header").remove();
  // Block elements would otherwise run together ("Ethiopia GujiOrigin: …") in .text().
  $("p, div, li, h1, h2, h3, h4, h5, h6, tr, td, th, dt, dd, section, article, summary, details").append("\n");
  $("br").replaceWith("\n");
  const bodyText = $("main").text() || $("body").text();
  const desc = clean(p?.description) || clean(meta("og:description")) || clean(meta("description"));
  const text = `${desc}\n${bodyText.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n")}`;

  let price: number | undefined;
  const offers = p?.offers ? (Array.isArray(p.offers) ? p.offers[0] : p.offers) : null;
  const rawPrice = offers?.price ?? offers?.lowPrice ?? (meta("product:price:amount") || meta("og:price:amount"));
  if (rawPrice !== undefined && rawPrice !== "") {
    const n = parseFloat(String(rawPrice).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) price = n;
  }

  const brand = typeof p?.brand === "string" ? p.brand : p?.brand?.name;
  const roaster = clean(brand) || clean(meta("og:site_name"));

  const f = fieldsFromText(text, desc, isProduct);
  const tasting = f.tasting;
  const origin = f.origin || findOrigins(`${desc}`);
  const process = f.process;
  const roastLevel = f.roast;

  let name = clean(p?.name) || (isProduct ? clean(meta("og:title")) : "");
  if (name && roaster) name = name.replace(new RegExp(`\\s*[|–—-]\\s*${roaster.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`, "i"), "").trim();

  // Bag size only from the product's own text (description / labelled weight).
  const amountG = findBagSize(f.sizeText || desc);

  const coffeeSignals = [tasting, origin, process, roastLevel].filter(Boolean).length;
  const coffeeWords = /\bcoffee|espresso|roast|beans?\b/i.test(`${name} ${desc} ${roaster}`);
  const evidence = (isProduct && coffeeWords) || coffeeSignals >= 2;

  return finalize(
    {
      name: evidence ? name : undefined,
      roaster: evidence ? roaster : undefined,
      origin,
      processMethod: process,
      roastLevel,
      tastingNotes: tasting,
      details: detailsLine(f),
      amountG,
      price: evidence ? price : undefined,
      url,
    },
    "link",
    undefined,
    evidence,
  );
}

/* SSRF guard: the importer fetches user-supplied URLs server-side, so never let it reach
   private / loopback / link-local / CGNAT (Tailscale) addresses — checked on every redirect hop.
   IMPORT_ALLOW_HOSTS (comma-separated hostnames/IPs) is an explicit escape hatch. */
export function isPrivateAddress(ip: string): boolean {
  let a = ip.toLowerCase();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) a = mapped[1];
  if (net.isIPv4(a)) {
    const [x, y] = a.split(".").map(Number);
    return (
      x === 0 || x === 10 || x === 127 || x >= 224 ||
      (x === 100 && y >= 64 && y <= 127) || // CGNAT / Tailscale
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 192 && y === 0) ||
      (x === 198 && (y === 18 || y === 19))
    );
  }
  if (net.isIPv6(a)) {
    return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith("ff");
  }
  return true; // not an IP — treat as unsafe
}

const allowedHosts = () =>
  new Set((process.env.IMPORT_ALLOW_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));

async function assertPublicHost(u: URL): Promise<void> {
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (allowedHosts().has(host)) return;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    throw new Error("private");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) throw new Error("private");
}

/* ------------------------------ Shopify product data ------------------------------
   Most roasters run on Shopify, which publishes every product as JSON at
   /products/<handle>.js — the roaster's own data: title, vendor, description HTML, tags,
   variants (bag sizes) and price. Far more reliable than scraping themed page markup. */

async function fetchShopifyProduct(u: URL): Promise<any | null> {
  const m = u.pathname.match(/^(.*\/products\/[^/?#.]+)(?:\.(?:js|json))?\/?$/);
  if (!m) return null;
  const jsUrl = new URL(`${m[1]}.js`, u.origin);
  try {
    await assertPublicHost(jsUrl);
    const r = await fetch(jsUrl, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok || !/json|javascript/i.test(r.headers.get("content-type") || "")) return null;
    const j = await r.json();
    return j && typeof j.title === "string" ? j : null;
  } catch {
    return null;
  }
}

export function extractFromShopify(prod: any, url: string): BagDraft & { evidence: boolean } {
  const descText = prod.description ? htmlToText(String(prod.description)) : "";
  const f = fieldsFromText(descText, descText);
  const tags: string[] = Array.isArray(prod.tags) ? prod.tags.map(String) : typeof prod.tags === "string" ? prod.tags.split(",").map((t: string) => t.trim()) : [];
  // Tags are the roaster's own classification — use them where the description is silent.
  const tagText = tags.join(" · ");
  const tagOrigin = findOrigins(tagText);
  const tagProcess = tags.find((t) => PROCESS_RE.test(t)) ?? "";
  const tagRoast = tags.map((t) => t.match(/\b(extra[- ]light|light[- ]medium|medium[- ]light|medium[- ]dark|light|medium|dark)\b(?=.*roast|$)/i)?.[1]).find(Boolean) ?? "";
  const variants: any[] = Array.isArray(prod.variants) ? prod.variants : [];
  const firstVariant = variants.find((v) => v.available !== false) ?? variants[0];
  const cents = firstVariant?.price ?? prod.price;
  const price = typeof cents === "number" && cents > 0 ? Math.round(cents) / 100 : typeof cents === "string" ? parseFloat(cents) : undefined;
  const sizeFrom = [firstVariant?.title, firstVariant?.option1, firstVariant?.option2, f.sizeText, ...(variants.map((v) => v.title))].filter(Boolean).join(" | ");
  const amountG = findBagSize(sizeFrom);
  const coffeeWords = /\bcoffee|espresso|roast|beans?|single origin|blend\b/i.test(`${prod.title} ${prod.type ?? ""} ${tagText} ${descText.slice(0, 2000)}`);
  const origin = f.origin || tagOrigin || findOrigins(`${prod.title} ${descText.slice(0, 600)}`);
  const signals = [origin, f.process || tagProcess, f.tasting, f.roast || tagRoast].filter(Boolean).length;
  return {
    name: clean(prod.title),
    roaster: clean(prod.vendor),
    origin,
    processMethod: f.process || tagProcess,
    roastLevel: f.roast || tagRoast,
    tastingNotes: f.tasting,
    details: detailsLine(f),
    amountG,
    price: Number.isFinite(price) && (price as number) > 0 ? price : undefined,
    url,
    evidence: coffeeWords || signals >= 2,
  };
}

/** Prefer the first non-empty value per field. */
function mergeDrafts(a: BagDraft, b: BagDraft): BagDraft {
  const out: BagDraft = { ...b };
  for (const [k, v] of Object.entries(a)) {
    if (v !== undefined && v !== null && v !== "") (out as any)[k] = v;
  }
  return out;
}

export async function importFromLink(url: string): Promise<ImportResult> {
  let u: URL;
  try {
    u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return { found: false, source: "link", message: "That doesn't look like a web link (it should start with https://)." };
  }
  const privateMsg = { found: false as const, source: "link", message: "That link points to a private or local network address, which the importer doesn't fetch." };
  try {
    await assertPublicHost(u);
  } catch (e: any) {
    if (e?.message === "private") return privateMsg;
  }

  // 1. Shopify product data (most roasters) — the cleanest source when available.
  const shop = await fetchShopifyProduct(u);
  const shopDraft = shop ? extractFromShopify(shop, url) : null;

  // 2. The page itself: JSON-LD / Open Graph / labelled page text.
  let pageResult: ImportResult | null = null;
  let pageError: string | null = null;
  let res: Response | null = null;
  try {
    // Follow redirects manually so every hop gets the private-address check.
    for (let hop = 0; hop < 6; hop++) {
      try {
        await assertPublicHost(u);
      } catch (e: any) {
        if (e?.message === "private") return privateMsg;
        throw e;
      }
      res = await fetch(u, {
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        u = new URL(loc, u);
        if (!/^https?:$/.test(u.protocol)) { pageError = "That page redirects somewhere the importer can't follow."; res = null; break; }
        res = null;
        continue;
      }
      break;
    }
    if (res && res.ok) pageResult = extractFromHtml((await res.text()).slice(0, 3_000_000), url);
    else if (res) pageError = `The page returned HTTP ${res.status}, so no details could be read.`;
    else if (!pageError) pageError = "That page redirected too many times.";
  } catch (e: any) {
    pageError = `Couldn't fetch that page (${e?.cause?.code || e?.code || e?.name || "network error"}).`;
  }

  if (shopDraft && shopDraft.evidence) {
    const { evidence: _e, ...draft } = shopDraft;
    const merged = pageResult && pageResult.found ? mergeDrafts(draft, pageResult.draft) : draft;
    return finalize(merged, "link");
  }
  if (pageResult) return pageResult;
  return { found: false, source: "link", message: pageError ?? "No coffee details were found on that page." };
}

/* ------------------------------ Bag photo ------------------------------ */

export function draftFromOcrText(text: string): BagDraft {
  const t = text.replace(/\r/g, "");
  const dateM =
    t.match(/roast(?:ed)?\s*(?:on|date)?\s*[:\-]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i) ||
    t.match(/roast(?:ed)?\s*(?:on|date)?\s*[:\-]?\s*([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]{2,8}\.? \d{4})/i);
  let roastDate: string | undefined;
  if (dateM) {
    const d = parseLooseDate(dateM[1]);
    if (d) roastDate = d;
  }
  const process = labelled(t, ["process", "processing"]) || (t.match(PROCESS_RE)?.[0] ?? "");
  const roastM = t.match(ROAST_RE);
  return {
    name: labelled(t, ["coffee", "name", "lot"]),
    roaster: labelled(t, ["roaster", "roasted by"]),
    origin: labelled(t, ["origin", "country", "region"]) || findOrigins(t),
    processMethod: process,
    roastLevel: roastM ? (roastM[1] || roastM[2] || "").trim() : "",
    roastDate,
    amountG: findBagSize(t),
  };
}

function parseLooseDate(s: string): string | undefined {
  const p = (n: number) => String(n).padStart(2, "0");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${p(+m[2])}-${p(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${p(+m[1])}-${p(+m[2])}`; // US month/day order
  }
  const d = new Date(s.replace(".", ""));
  if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return undefined;
}

export async function tesseractAvailable(): Promise<boolean> {
  try {
    await execFileP("tesseract", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function importFromPhoto(file: { path: string; buffer: Buffer; mimetype: string }): Promise<ImportResult> {
  const mediaType = file.mimetype === "image/png" ? "image/png" : "image/jpeg";
  if (llmEnabled()) {
    try {
      const d = await readLabelWithVision(file.buffer, mediaType);
      return finalize(
        {
          name: d.name, roaster: d.roaster, origin: d.origin, processMethod: d.processMethod, roastLevel: d.roastLevel,
          roastDate: /^\d{4}-\d{2}-\d{2}$/.test(d.roastDate) ? d.roastDate : undefined, amountG: d.amountG ?? undefined,
        },
        "vision",
      );
    } catch (e) {
      console.warn("Vision label read failed, falling back to OCR:", e);
    }
  }
  if (!(await tesseractAvailable())) {
    return { found: false, source: "ocr", message: "Couldn't read the label: no LLM key is set and local OCR (Tesseract) isn't installed. Fill the form in by hand." };
  }
  let text = "";
  try {
    const { stdout } = await execFileP("tesseract", [file.path, "stdout", "-l", "eng", "--psm", "3"], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    text = stdout;
  } catch {
    return { found: false, source: "ocr", message: "Couldn't read the label — OCR failed on that image." };
  }
  const r = finalize(draftFromOcrText(text), "ocr", text.trim());
  if (r.found) r.message += " (read with local OCR — bean and roaster names may need typing in; the raw text is shown below)";
  return r;
}
