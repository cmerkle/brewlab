// Water recipes: a base water, a volume and additives (minerals, drops, packets). Hardness (GH) and
// alkalinity (KH) are in ppm as CaCO₃. Additive strengths are data (catalog/water-additives.json);
// a strength that isn't published stays unknown, never guessed.

export const AMOUNT_UNITS = ["g", "mg", "ml", "drops", "packets", "tsp", "capsules"] as const;
export type AmountUnit = (typeof AMOUNT_UNITS)[number];
export const VOLUME_UNITS = ["ml", "L", "gal"] as const;
export type VolumeUnit = (typeof VOLUME_UNITS)[number];
export const VOLUME_LABELS: Record<VolumeUnit, string> = { ml: "ml", L: "L", gal: "gal (US)" };

const LITRES: Record<VolumeUnit, number> = { ml: 0.001, L: 1, gal: 3.785411784 };
export const toLitres = (v: number, unit: VolumeUnit) => v * LITRES[unit];

export interface WaterBase { id: string; name: string; gh: number | null; kh: number | null; note?: string }
export interface AdditiveRef { amount: number; unit: AmountUnit; volume: number; volumeUnit: VolumeUnit; gh: number | null; kh: number | null; tds?: number | null }
export interface WaterAdditive {
  id: string;
  name: string;
  kind: "salt" | "drops" | "packet" | "concentrate";
  formula?: string;
  /** What `ref.amount` of it adds to `ref.volume` of water. */
  ref: AdditiveRef;
  basis: "calculated" | "published";
  source?: string;
  note?: string;
}
/**
 * One additive in a recipe: a library additive (`additiveId`), one of your own concentrates
 * (`concentrateId`, another water recipe marked as a concentrate), or something else of your own
 * that carries `gh`/`kh`: what it adds in this recipe, if you know.
 */
export interface WaterLine { additiveId?: string | null; concentrateId?: number | null; name: string; amount: number; unit: AmountUnit; gh?: number | null; kh?: number | null }
/** Your concentrates' own strength (ppm of the stock), by id. */
export type ConcentrateMap = Map<number, { name: string; gh: number | null; kh: number | null }>;
/** A concentrate is weighed (or measured) in: g, mg or ml (1 ml ≈ 1 g for these dilute solutions). */
export const CONCENTRATE_UNITS: AmountUnit[] = ["g", "mg", "ml"];
const concentrateLitres = (amount: number, unit: AmountUnit) => (unit === "mg" ? amount / 1e6 : unit === "g" || unit === "ml" ? amount / 1000 : null);
export interface WaterMix { baseId?: string | null; baseName?: string | null; baseGh?: number | null; baseKh?: number | null; volume: number; volumeUnit: VolumeUnit; additives: WaterLine[] }
export interface WaterCatalogData { bases: WaterBase[]; additives: WaterAdditive[] }

/** Same unit, or grams ↔ milligrams. Anything else can't be compared. */
export function convertAmount(amount: number, from: AmountUnit, to: AmountUnit): number | null {
  if (from === to) return amount;
  if (from === "mg" && to === "g") return amount / 1000;
  if (from === "g" && to === "mg") return amount * 1000;
  return null;
}
/** Units an additive can be measured in (its own, plus g/mg). */
export const unitsFor = (a: WaterAdditive): AmountUnit[] => AMOUNT_UNITS.filter((u) => convertAmount(1, u, a.ref.unit) != null);

export interface Hardness {
  /** ppm as CaCO₃, rounded; null when something in the mix isn't known. */
  gh: number | null;
  kh: number | null;
  /** Why a number is unknown (plain words, one per cause). */
  unknown: string[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function hardness(mix: WaterMix, cat: WaterCatalogData, concentrates: ConcentrateMap = new Map()): Hardness {
  const unknown: string[] = [];
  const base = mix.baseId ? cat.bases.find((b) => b.id === mix.baseId) : undefined;
  let gh: number | null = mix.baseGh ?? base?.gh ?? null;
  let kh: number | null = mix.baseKh ?? base?.kh ?? null;
  const baseName = base?.name ?? mix.baseName ?? "the base water";
  if (gh == null || kh == null) unknown.push(`${baseName}: enter its hardness and alkalinity`);
  const litres = toLitres(mix.volume, mix.volumeUnit);
  if (!(litres > 0)) return { gh: null, kh: null, unknown: ["Enter the volume of water"] };
  for (const line of mix.additives) {
    if (line.concentrateId != null) {
      const c = concentrates.get(line.concentrateId);
      const l = concentrateLitres(line.amount, line.unit);
      if (!c || l == null) {
        unknown.push(!c ? `${line.name}: that concentrate is gone` : `${line.name}: measure a concentrate in g, mg or ml`);
        gh = kh = null;
        continue;
      }
      // ppm of the stock × the share of the final water that is stock.
      if (c.gh == null || c.kh == null) unknown.push(`${c.name}: its own hardness or alkalinity is unknown`);
      gh = gh == null || c.gh == null ? null : gh + (c.gh * l) / litres;
      kh = kh == null || c.kh == null ? null : kh + (c.kh * l) / litres;
      continue;
    }
    const a = line.additiveId ? cat.additives.find((x) => x.id === line.additiveId) : undefined;
    if (a) {
      const amt = convertAmount(line.amount, line.unit, a.ref.unit);
      if (amt == null) {
        unknown.push(`${a.name}: measured in ${line.unit}, but its strength is per ${a.ref.unit}`);
        gh = kh = null;
        continue;
      }
      const f = (amt / a.ref.amount) * (toLitres(a.ref.volume, a.ref.volumeUnit) / litres);
      if (a.ref.gh == null) unknown.push(`${a.name}: hardness not published`);
      if (a.ref.kh == null) unknown.push(`${a.name}: alkalinity not published`);
      gh = gh == null || a.ref.gh == null ? null : gh + a.ref.gh * f;
      kh = kh == null || a.ref.kh == null ? null : kh + a.ref.kh * f;
    } else {
      if (line.gh == null || line.kh == null) unknown.push(`${line.name || "An additive"}: enter what it adds`);
      gh = gh == null || line.gh == null ? null : gh + line.gh;
      kh = kh == null || line.kh == null ? null : kh + line.kh;
    }
  }
  return { gh: gh == null ? null : r1(gh), kh: kh == null ? null : r1(kh), unknown: [...new Set(unknown)] };
}

export const fmtPpm = (n: number | null) => (n == null ? "—" : `${Math.round(n)}`);
const trimNum = (n: number) => String(Math.round(n * 1000) / 1000);
export const fmtAmount = (l: Pick<WaterLine, "amount" | "unit">) => `${trimNum(l.amount)} ${l.amount === 1 && l.unit === "packets" ? "packet" : l.amount === 1 && l.unit === "drops" ? "drop" : l.unit}`;
export const fmtVolume = (v: number, u: VolumeUnit) => `${trimNum(v)} ${u === "gal" ? "gal" : u}`;
