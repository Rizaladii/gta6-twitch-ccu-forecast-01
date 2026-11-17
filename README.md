[![make.fun](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Rizaladii/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Rizaladii/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)

# GTA VI Twitch-viewer forecaster

Forecasts how many people watch Grand Theft Auto VI live on Twitch in each
hour of its release day (2026-11-19 UTC), after the first hour — five
quantiles (5/25/50/75/95%) per hour, hours 2–24.

[make.fun bounty](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) ·
[referral](https://make.fun/r/f4mz6c1w)

## Method

The forecast is **relative to hour 1's print, never absolute**. Every
comparable launch in the case is reduced to its launch-day curve in log
space, `ln(viewers_h / viewers_1)`. The day's shape is governed by one
number, the log **peak ratio** (the largest log-ratio over hours 2–24):
across launches the peak falls steeply with launch size — tiny launches
peak 100x their first hour, launches above 100k viewers peak about 1.5x —
and the **shape** (curve minus peak) is far more stable across launches
than the raw curve, especially near the evening peak.

The forecast is built in two parts per case:

1. **Peak**: a kernel-weighted local-linear fit of the log peak ratio on
   `ln(hour-1 viewers)` across the usable comparables (Gaussian kernel,
   bandwidth 0.9 in log units, plus a small floor weight so the estimate
   never collapses to one neighbour). The fitted slope is clamped to
   [-1.5, 0] and shrunk 25% toward 0, and the peak is floored at -0.6.
2. **Shape**: per hour, the kernel-weighted median of
   (curve_h − peak) across the comparables, added to the predicted peak.
   Hour 2 uses the raw log-ratio median instead: the early dip is nearly
   the same for every launch, while the shape there is dominated by how
   big the peak is.

Quantiles are the median plus a normal spread widening like a random
walk, `sigma = 0.09 * sqrt(h - 1)` in log units, **asymmetric**: 0.7x
below the median (the early dip is bounded) and 1.0x above it (evening
spikes are unbounded).

Early-access launches and "weak" comparables are excluded by their unlock
notes, and the GTA VI category's own pre-release history is excluded by
name — it is not a launch curve. Streams and categories_hourly are null
in practice, so the model works without them.

Tested and rejected, on the practice cases (with leave-one-out over the
practice cases as the guard against overfitting): a global scale slope
(pooled or per-hour OLS on ln hour-1 — it destroys the score on big
launches, 0.25 → 0.58); the hour-1 channel count as a second kernel
feature; platform and release-weekday similarity weightings; peak-hour
alignment of the shapes; empirical / IQR / SD spreads; a per-hour spread
fitted from leave-one-out residuals; scale-conditioning the shape on the
peak. The hyperparameters sit on a flat optimum (0.135–0.138 across the
neighbouring grid), not a sharp one.

## Practice score (local, pinball loss on the log scale)

| case | loss | typical miss | 90% coverage |
| ---- | ---- | ------------ | ------------ |
| Wolverine (p00) | 0.123 | 25.2% | 0.957 |
| Red Dead Redemption 2 (p01) | 0.106 | 19.6% | 0.913 |
| God of War Ragnarök (p02) | 0.097 | 16.0% | 0.957 |
| Spider-Man 2 (p03) | 0.215 | 31.5% | 0.652 |
| **overall** | **0.135** | | |

House baseline: 0.387 overall. v1 (plain median curve): 0.248.
Leave-one-out over the practice cases (hyperparameters tuned on 3, tested
on the 4th): 0.141. Practice is no guide to the final — but it is the
only signal available before submitting.

## Run

Node 22, standard library only, no network, deterministic:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```
