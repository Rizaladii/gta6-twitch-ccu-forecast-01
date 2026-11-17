// GTA VI launch-day Twitch-viewer forecaster (gta6-twitch-ccu-forecast-01).
//
// Method: the forecast is RELATIVE to hour 1's print, never absolute. Every
// comparable launch in the case is reduced to its launch-day curve in log
// space, ln(viewers_h / viewers_1) for h = 2..24. The day's shape is
// governed by one number, the log PEAK ratio (the largest log-ratio over
// hours 2..24): across launches the peak falls steeply with launch size
// (tiny launches peak 100x their first hour, launches above 100k viewers
// peak about 1.5x), and the SHAPE (curve minus peak) is far more stable
// across launches than the raw curve, especially near the evening peak.
//
// The forecast is therefore built in two parts per case:
//   1. PEAK: a kernel-weighted local-linear fit of the log peak ratio on
//      ln(hour-1 viewers) across the usable comparables (Gaussian kernel,
//      bandwidth 0.9 in log units, plus a small floor weight so the
//      estimate never collapses to one neighbour). The fitted slope is
//      clamped to [-1.5, 0] and shrunk 25% toward 0: the peak falls with
//      scale, but a straight global line through the tiny-game cloud would
//      extrapolate to an absurdly flat day for a huge launch, so the local
//      fit and the shrink keep it honest. The peak is floored at -0.6:
//      even the biggest launch on record peaked at its first hour, never
//      far below it.
//   2. SHAPE: per hour, the kernel-weighted median of (curve_h - peak)
//      across the comparables, added to the predicted peak. For hour 2 the
//      raw log-ratio is used instead: the early dip is nearly the same for
//      every launch, while the shape there is dominated by how big the
//      peak is.
//   3. UNLOCK-JUMP BOOST (v3): the centre is lifted by +0.20 log units
//      at hours 5-8, the US unlock window (US East midnight EDT at hour 5,
//      US West midnight PDT at hour 8). The median comparable's shape
//      systematically under-states the US unlock jump for big Western
//      launches: all four practice cases under-predict hours 5-8, by
//      +0.27 to +0.39 log units at the worst hours, and the boost is a
//      flat plateau at 0.15-0.20 (0.1290 at both), not a sharp optimum.
//      It is a Western-blockbuster correction, not a universal one: on
//      comparable-LOO it helps the two biggest targets (ELDEN RING,
//      Cyberpunk 2077) and hurts mid-size ones, so it is kept flat and
//      small rather than scaled with launch size.
// Quantiles are the median plus a normal spread that widens like a random
// walk, sigma = 0.09 * sqrt(h - 1) in log units, ASYMMETRIC: the spread
// below the median is 0.7x (viewers can only fall so far; the early dip is
// bounded) and 1.0x above it (evening spikes are unbounded).
//
// What is left out, and why:
//   - Early-access launches (their day-1 curve already peaked days before
//     the release day) and "weak"-tier comparables (free-to-play /
//     live-service launches, not a one-day event) are excluded by their
//     unlock notes. The Grand Theft Auto VI category's own pre-release
//     history is not a launch curve, so it is excluded by name.
//   - The hour-1 CHANNEL count was tested as a second kernel feature and
//     REJECTED (it hurts: 0.188 -> 0.196 on practice). Platform and
//     release-weekday similarity weightings were tested and REJECTED (both
//     hurt). A global scale slope (pooled or per-hour OLS on ln hour-1)
//     was tested and REJECTED (it destroys the score on big launches:
//     0.25 -> 0.58). Empirical / IQR / SD spreads lose to the fixed
//     random-walk spread. A per-hour spread fitted from leave-one-out
//     residuals loses too.
//   - One-factor shape (per-hour regression of the curve on the predicted
//     peak) was tested and REJECTED (0.150-0.162 on practice vs 0.135:
//     the regression slopes are too noisy across the comparable cloud).
//     Peak-similarity shape weighting loses too (0.137-0.138).
//   - Empirical-quantile forecasts (quantiles from the cross-comparable
//     shape distribution) help on practice (0.133 at blend 0.75) but
//     FAIL leave-one-out (0.142 vs 0.139 for v2): the gain is p03 alone.
//     A quadratic peak fit helps comparable-LOO (0.321 vs 0.343) but
//     FAILS practice leave-one-out (0.145, and LOO picks the linear peak).
//     IQR-scaled spreads lose (0.136-0.145).
//   - Streams / categories_hourly are null in practice, so the model works
//     without them and ignores them when present.
//
// Local practice score (4 cases, pinball loss on the log scale): 0.129
// overall vs v2's 0.135 and the house baseline's 0.387 (p00 0.126,
// p01 0.087, p02 0.090, p03 0.214). Leave-one-out over the practice cases
// (hyperparameters tuned on 3, tested on the 4th): 0.131 vs v2's 0.139.
// Comparable-LOO (targets with hour-1 above 20k): 0.356 vs v2's 0.343 —
// the boost is a big-Western-launch correction, and GTA VI is the biggest
// Western launch there is. Practice is no guide to the final, but it is
// the only signal available before submitting, and the boost sits on a
// flat optimum (0.1290 at both 0.15 and 0.20), not a sharp one.
//
// Node 22, standard library only, no network, deterministic: no random
// numbers, no clock reads, same input always writes the same bytes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Kernel bandwidth on ln(hour-1 viewers). */
const BANDWIDTH = 0.9;
/** Small floor weight so the estimate never collapses to one neighbour. */
const FLOOR_WEIGHT = 0.02;
/** The fitted peak slope is shrunk this far toward 0 (1 = no shrink). */
const SLOPE_SHRINK = 0.75;
/** The predicted log peak ratio never goes below this. */
const PEAK_FLOOR = -0.6;
/** Spread of an hour's move, in log units per square-root hour. */
const SIGMA = 0.09;
/** Spread multiplier below the median (the early dip is bounded). */
const DOWN_MULT = 0.7;
/** Hours below this one use the raw log-ratio median, not peak + shape. */
const RAW_BELOW_HOUR = 3;
/** Lift added to the centre during the US unlock window (hours 5-8). */
const JUMP_BOOST = 0.2;
/** First hour of the US unlock window (US East midnight EDT). */
const JUMP_FIRST_HOUR = 5;
/** Last hour of the US unlock window (US West midnight PDT). */
const JUMP_LAST_HOUR = 8;

type Levels = number[];

interface KnownRow {
  hour: number;
  viewers: number;
}

interface CaseInput {
  levels: Levels;
  known: KnownRow[];
  forecast: { hour: number }[];
  history?: { viewers: number }[];
  comparables?: {
    name: string;
    day_start: string;
    unlock?: string;
    hourly: { from: string; viewers: number }[];
  }[];
}

interface LaunchCurve {
  peak: number;
  logV1: number;
  byHour: Map<number, number>;
}

/** Standard normal quantiles at the case's levels (Acklam's approximation). */
function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
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

/** Weighted median of (value, weight) pairs; 0 when the weights sum to 0. */
function weightedMedian(pairs: [number, number][]): number {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return 0;
  let acc = 0;
  for (const [v, w] of [...pairs].sort((a, b) => a[0] - b[0])) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return [...pairs].sort((a, b) => a[0] - b[0]).at(-1)?.[0] ?? 0;
}

/** Round to 2 decimals, half up. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** A comparable is usable as a launch curve when it is a real launch. */
function usableComparable(c: NonNullable<CaseInput['comparables']>[number]): boolean {
  if (c.name.toLowerCase().includes('grand theft auto vi')) return false;
  const unlock = (c.unlock ?? '').toLowerCase();
  if (unlock.includes('early access')) return false;
  if (unlock.includes('tier: weak')) return false;
  return true;
}

/**
 * One comparable's launch-day curve in log space: ln(viewers_h / viewers_1)
 * for h = 2..24, plus its peak log-ratio and its ln(hour-1 viewers).
 */
function toLaunchCurve(c: NonNullable<CaseInput['comparables']>[number]): LaunchCurve | null {
  const dayStart = Date.parse(c.day_start);
  if (Number.isNaN(dayStart)) return null;
  const byHour = new Map<number, number>();
  for (const pt of c.hourly ?? []) {
    const t = Date.parse(pt.from);
    if (Number.isNaN(t) || !(pt.viewers > 0)) continue;
    const h = Math.floor((t - dayStart) / 3_600_000) + 1;
    if (h >= 1 && h <= 24 && !byHour.has(h)) byHour.set(h, pt.viewers);
  }
  const v1 = byHour.get(1);
  if (v1 === undefined) return null;
  const curve = new Map<number, number>();
  for (const [h, v] of byHour) {
    if (h >= 2) curve.set(h, Math.log(v / v1));
  }
  if (curve.size === 0) return null;
  return { peak: Math.max(...curve.values()), logV1: Math.log(v1), byHour: curve };
}

/** Gaussian kernel weight of a comparable for a case with this ln(hour-1). */
function kernelWeight(logV1: number, targetLogV1: number): number {
  const d = (logV1 - targetLogV1) / BANDWIDTH;
  return Math.exp(-0.5 * d * d) + FLOOR_WEIGHT;
}

/**
 * The forecast of one case: the predicted peak from the local-linear fit,
 * the per-hour shape as the kernel-weighted median of (curve - peak), the
 * raw median for the earliest hours, the unlock-jump boost at hours 5-8,
 * widened by the asymmetric random-walk spread.
 */
function forecastCase(c: CaseInput): { hour: number; q: number[] }[] {
  const first = c.known.find((k) => k.hour === 1);
  let p1 = first !== undefined && first.viewers > 0 ? first.viewers : 0;
  if (p1 <= 0 && c.history !== undefined && c.history.length > 0) {
    const last = c.history[c.history.length - 1];
    if (last.viewers > 0) p1 = last.viewers;
  }
  p1 = Math.max(1, p1);
  const logP1 = Math.log(p1);

  const levels = c.levels.length > 0 ? c.levels : [0.05, 0.25, 0.5, 0.75, 0.95];
  const z = levels.map((t) => normalQuantile(t));

  const curves: LaunchCurve[] = [];
  for (const comp of c.comparables ?? []) {
    if (!usableComparable(comp)) continue;
    const curve = toLaunchCurve(comp);
    if (curve !== null) curves.push(curve);
  }

  // --- predicted log peak ratio: kernel-weighted local-linear fit of peak
  // on ln(hour-1 viewers), slope clamped to [-1.5, 0] and shrunk. ---
  let peak = 0;
  if (curves.length > 0) {
    const ws = curves.map((lc) => kernelWeight(lc.logV1, logP1));
    const sw = ws.reduce((s, w) => s + w, 0);
    const meanX = curves.reduce((s, lc, i) => s + ws[i] * lc.logV1, 0) / sw;
    const meanY = curves.reduce((s, lc, i) => s + ws[i] * lc.peak, 0) / sw;
    const varX = curves.reduce((s, lc, i) => s + ws[i] * (lc.logV1 - meanX) ** 2, 0) / sw;
    let slope = 0;
    if (varX > 1e-9) {
      slope = curves.reduce((s, lc, i) => s + ws[i] * (lc.logV1 - meanX) * (lc.peak - meanY), 0) / sw / varX;
    }
    slope = Math.max(-1.5, Math.min(0, slope)) * SLOPE_SHRINK;
    peak = Math.max(PEAK_FLOOR, meanY + slope * (logP1 - meanX));
  }

  return c.forecast.map(({ hour }) => {
    let centre: number;
    let support = 0;
    if (hour < RAW_BELOW_HOUR) {
      // The early dip is nearly the same for every launch: raw median.
      const pairs: [number, number][] = [];
      for (const lc of curves) {
        const r = lc.byHour.get(hour);
        if (r !== undefined && Number.isFinite(r)) pairs.push([r, kernelWeight(lc.logV1, logP1)]);
      }
      support = pairs.length;
      centre = weightedMedian(pairs);
    } else {
      // Peak + shape: the shape is far more stable than the raw curve.
      const pairs: [number, number][] = [];
      for (const lc of curves) {
        const r = lc.byHour.get(hour);
        if (r !== undefined && Number.isFinite(r)) pairs.push([r - lc.peak, kernelWeight(lc.logV1, logP1)]);
      }
      support = pairs.length;
      centre = peak + weightedMedian(pairs);
    }
    // The US unlock window: the median comparable understates how hard
    // the US unlocks hit for a big Western launch, so lift the centre
    // there. Hours 5-8 only; the early hours and the evening peak are
    // untouched. The boost is a property of the case, not of the
    // comparables, so it is added AFTER the sparse-support shrink below:
    // a thinly supported hour still gets the full unlock lift.
    if (support > 0 && support < 3) centre *= support / 3;
    if (hour >= JUMP_FIRST_HOUR && hour <= JUMP_LAST_HOUR) centre += JUMP_BOOST;
    // A centre over very few curves is noise, not signal: with fewer than
    // three comparables supplying this hour, blend it toward persistence
    // in proportion. In the practice cases every hour has all curves, so
    // this never bites there; it only guards the final if the case's
    // comparables ever arrive sparse.
    const spread = SIGMA * Math.sqrt(Math.max(0, hour - 1));
    let q = z.map((zi) => round2(p1 * Math.exp(centre + zi * spread * (zi < 0 ? DOWN_MULT : 1))));
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
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseInput;
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
