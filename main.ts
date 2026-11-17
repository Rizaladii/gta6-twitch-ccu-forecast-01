// GTA VI launch-day Twitch-viewer forecaster (gta6-twitch-ccu-forecast-01).
//
// Method: the forecast is RELATIVE to hour 1's print, never absolute. Every
// comparable launch in the case is reduced to its launch-day curve in log
// space, ln(viewers_h / viewers_1) for h = 2..24, and each hour's median
// log-ratio across the comparables is the shape of the day: a dip in the
// small hours (only the early timezones have unlocked), a jump when the US
// east coast unlocks, then a climb into the US evening peak and a late
// fall. The median is shrunk 10% toward persistence (flat at hour 1) as a
// hedge: a launch whose first hour is already huge has a flatter day than
// the median comparable. Quantiles are the median plus a normal spread that
// widens like a random walk, sigma = 0.15 * sqrt(h - 1) in log units.
//
// What is left out, and why:
//   - Early-access launches (their day-1 curve already peaked days before
//     the release day, so their shape is not a launch shape) and "weak"
//     comparables (free-to-play / live-service launches, not a one-day
//     event) are excluded by their unlock notes.
//   - The Grand Theft Auto VI category's own pre-release history is not a
//     launch curve, so it is excluded by name.
//   - Scale-conditioning on the hour-1 print was tested and REJECTED: the
//     near-perfect negative correlation between ln(hour-1) and ln(peak
//     ratio) across comparables is driven by tiny, sparsely sampled games;
//     applied to the practice cases it destroys the score (0.25 -> 0.58).
//     The plain median wins on practice and on leave-one-out over the
//     comparables. Streams / categories_hourly are null in practice, so the
//     model works without them and ignores them when present.
//
// Local practice score (4 cases, pinball loss on the log scale): 0.248
// overall vs the house baseline's 0.387 (p00 0.343, p01 0.147, p02 0.242,
// p03 0.260). Typical miss ~55%, 90% coverage ~0.91. Practice is no guide
// to the final, but beating the baseline on practice is the only signal
// available before submitting.
//
// Node 22, standard library only, no network, deterministic: no random
// numbers, no clock reads, same input always writes the same bytes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The spread of an hour's move, in natural-log units per square-root hour. */
const SIGMA = 0.15;
/** The median log-ratio curve is shrunk this far toward persistence (0). */
const SHRINK = 0.9;

interface KnownRow {
  hour: number;
  viewers: number;
}

interface ForecastRow {
  hour: number;
}

interface ComparableHour {
  from: string;
  viewers: number;
}

interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  hourly: ComparableHour[];
}

interface Case {
  levels: number[];
  known: KnownRow[];
  forecast: ForecastRow[];
  history?: Array<{ viewers: number }>;
  comparables?: Comparable[];
}

/** The standard normal's quantile at each level, in the case's level order. */
const Z_TABLE: Record<string, number> = {
  '0.05': -1.6448536269514722,
  '0.25': -0.6744897501960817,
  '0.5': 0,
  '0.75': 0.6744897501960817,
  '0.95': 1.6448536269514722,
};

/** Inverse standard normal CDF (Acklam's approximation) for any level. */
function normQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`level ${p} outside (0, 1)`);
  const key = String(p);
  if (key in Z_TABLE) return Z_TABLE[key];
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Median of numbers (sorted copy; the mean of the middle two when even). */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** A comparable is usable as a launch curve when it is a real launch. */
function isUsableComparable(c: Comparable): boolean {
  if (c.name.toLowerCase().includes('grand theft auto vi')) return false;
  const unlock = (c.unlock ?? '').toLowerCase();
  if (unlock.includes('early access')) return false;
  if (unlock.includes('tier: weak')) return false;
  return true;
}

/**
 * One comparable's launch-day curve in log space: ln(viewers_h / viewers_1)
 * for h = 2..24, keyed by the hour's offset from the comparable's own
 * day_start. Hours with no point (or a non-positive count) are skipped.
 */
function logRatioCurve(c: Comparable): Map<number, number> {
  const dayStart = Date.parse(c.day_start);
  const byHour = new Map<number, number>();
  if (Number.isNaN(dayStart)) return byHour;
  for (const pt of c.hourly ?? []) {
    const t = Date.parse(pt.from);
    if (Number.isNaN(t) || !(pt.viewers > 0)) continue;
    const h = Math.floor((t - dayStart) / 3_600_000) + 1;
    if (h >= 1 && h <= 24 && !byHour.has(h)) byHour.set(h, pt.viewers);
  }
  const v1 = byHour.get(1);
  if (v1 === undefined) return new Map();
  const curve = new Map<number, number>();
  for (const [h, v] of byHour) {
    if (h >= 2) curve.set(h, Math.log(v / v1));
  }
  return curve;
}

/**
 * The forecast of one case: per hour, the shrunk median log-ratio across
 * the usable comparables, widened by the random-walk spread. Falls back to
 * persistence (median 0) when no comparable supplies a curve.
 */
function forecastCase(c: Case): { hour: number; q: number[] }[] {
  const first = c.known.find((k) => k.hour === 1);
  let p1 = first !== undefined && first.viewers > 0 ? first.viewers : 0;
  if (p1 <= 0 && c.history !== undefined && c.history.length > 0) {
    const last = c.history[c.history.length - 1];
    if (last.viewers > 0) p1 = last.viewers;
  }
  p1 = Math.max(1, p1);

  const levels = c.levels.length > 0 ? c.levels : [0.05, 0.25, 0.5, 0.75, 0.95];
  const z = levels.map((t) => normQuantile(t));

  const curves: Map<number, number>[] = [];
  for (const comp of c.comparables ?? []) {
    if (!isUsableComparable(comp)) continue;
    const curve = logRatioCurve(comp);
    if (curve.size > 0) curves.push(curve);
  }

  return c.forecast.map(({ hour }) => {
    const ratios: number[] = [];
    for (const curve of curves) {
      const r = curve.get(hour);
      if (r !== undefined && Number.isFinite(r)) ratios.push(r);
    }
    // A median over very few curves is noise, not signal: with fewer than
    // five comparables supplying this hour, blend the median toward
    // persistence in proportion. In the practice cases every hour has all
    // curves, so this never bites there; it only guards the final if the
    // case's comparables ever arrive sparse.
    let m = median(ratios) * SHRINK;
    if (ratios.length > 0 && ratios.length < 5) m *= ratios.length / 5;
    const spread = SIGMA * Math.sqrt(Math.max(0, hour - 1));
    let q = z.map((zi) => round2(p1 * Math.exp(m + zi * spread)));
    q = q.map((v) => Math.min(1e9, Math.max(1, v)));
    for (let i = 1; i < q.length; i++) q[i] = Math.max(q[i], q[i - 1]);
    return { hour, q };
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
