// Version strings ("0.1.0", "v0.2.0-beta.1"): parsing and comparing, for the update check.

export interface Semver { major: number; minor: number; patch: number; pre: string | null }

export function parseVersion(v: string | null | undefined): Semver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec((v ?? "").trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null } : null;
}

/** <0 if a is older than b, 0 if the same, >0 if newer. Unparseable versions compare as equal. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (const k of ["major", "minor", "patch"] as const) if (x[k] !== y[k]) return x[k] - y[k];
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1; // 1.0.0 is newer than 1.0.0-beta
  if (y.pre === null) return -1;
  const xs = x.pre.split("."), ys = y.pre.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === undefined) return -1;
    if (ys[i] === undefined) return 1;
    const xn = /^\d+$/.test(xs[i]), yn = /^\d+$/.test(ys[i]);
    if (xn && yn && +xs[i] !== +ys[i]) return +xs[i] - +ys[i];
    if (xn !== yn) return xn ? -1 : 1;
    if (!xn && xs[i] !== ys[i]) return xs[i] < ys[i] ? -1 : 1;
  }
  return 0;
}
