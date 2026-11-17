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

The forecast is **relative to hour 1's print, never absolute**: every
comparable launch in the case is reduced to its launch-day curve in log
space, `ln(viewers_h / viewers_1)`, and each hour's **median** log-ratio
across the comparables is the shape of the day — a dip in the small hours
(only the early timezones have unlocked), a jump when the US east coast
unlocks, then a climb into the US evening peak and a late fall. The median
is shrunk 10% toward persistence as a hedge, and quantiles are the median
plus a normal spread widening like a random walk
(`sigma = 0.15 * sqrt(h - 1)` in log units).

Early-access launches and "weak" comparables are excluded by their unlock
notes (their day-1 curve already peaked, or they are not a one-day event),
and the GTA VI category's own pre-release history is excluded by name —
it is not a launch curve. Streams and categories_hourly are null in
practice, so the model works without them.

Tested and rejected, on the practice cases: conditioning the curve on the
hour-1 print's size (the near-perfect correlation across comparables is
driven by tiny, sparsely sampled games; it wrecks the practice score),
asymmetric spreads, and smoothing the median curve.

## Practice score (local, pinball loss on the log scale)

| case | loss | typical miss | 90% coverage |
| ---- | ---- | ------------ | ------------ |
| Wolverine (p00) | 0.343 | 84.1% | 0.783 |
| Red Dead Redemption 2 (p01) | 0.147 | 19.7% | 1.000 |
| God of War Ragnarök (p02) | 0.242 | 55.0% | 0.957 |
| Spider-Man 2 (p03) | 0.260 | 52.1% | 0.783 |
| **overall** | **0.248** | | |

House baseline: 0.387 overall. Practice is no guide to the final — but
beating the baseline on practice is the only signal available before
submitting.

## Run

Node 22, standard library only, no network, deterministic:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```
