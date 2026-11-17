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

The forecast is built in four parts per case:

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
3. **Unlock-jump boost (v4)**: a **raised-cosine bump** during the US
   unlock window — height 0.24 log units, centred at hour 6.5 with
   half-width 2.5 hours, so hours 5–8 get 0.083 / 0.217 / 0.217 / 0.083
   and hours 4 and 9 get 0. The median comparable's shape
   systematically under-states the US unlock jump for big Western
   launches — all four practice cases under-predict hours 5–8 — and the
   cosine profile fits the jump's rise and fall better than v3's flat
   0.20 plateau (practice 0.1249 vs 0.1290). It is a
   Western-blockbuster correction, not a universal one: on
   comparable-LOO it helps the two biggest targets (ELDEN RING, Cyberpunk
   2077) and hurts mid-size ones.
4. **Early-dip correction (v4)**: the centre is lowered by 0.10 log
   units at hours 3–4 — the median shape over-states the early dip for
   the biggest launches. Validated together with the cosine boost, not
   alone.

Quantiles are the median plus a normal spread widening like a random
walk, `sigma = 0.08 * sqrt(h - 1)` in log units, **asymmetric**: 0.8x
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
peak; a one-factor shape (per-hour regression of the curve on the
predicted peak, 0.150–0.162); peak-similarity shape weighting (0.137);
empirical-quantile forecasts (help on practice at 0.133 but fail
leave-one-out at 0.142); a quadratic peak fit (helps comparable-LOO but
fails practice leave-one-out at 0.145). The hyperparameters sit on a flat
optimum, not a sharp one.

## Practice score (local, pinball loss on the log scale)

| case | loss | typical miss | 90% coverage |
| ---- | ---- | ------------ | ------------ |
| Wolverine (p00) | 0.120 | 24.0% | 0.957 |
| Red Dead Redemption 2 (p01) | 0.095 | 17.5% | 0.957 |
| God of War Ragnarök (p02) | 0.083 | 13.5% | 0.957 |
| Spider-Man 2 (p03) | 0.202 | 30.8% | 0.652 |
| **overall** | **0.125** | | |

House baseline: 0.387 overall. v1 (plain median curve): 0.248. v2
(local-linear peak + peak/shape): 0.135. v3 (flat unlock boost): 0.129.
Honest 72-point leave-one-out over the practice cases: 0.1305 vs v3's
0.1312 — a 0.0007 gain on 4 cases alone, which is noise. So v4 was
only adopted after a **bigger validation set**: 10 additional big
launches from SullyGnome's published "Average viewers" per hour
(Sekiro, God of War, Death Stranding, Horizon Forbidden West, Pokémon
Legends: Arceus, Star Wars Jedi: Survivor, Final Fantasy XVI, Lies of
P, Donkey Kong Bananza, Pokémon Legends: Z-A — all hour-1 ≥ 20k,
complete 24-hour release days), scored with the same pinball scorer.
On that set v4 scores 0.1567 vs v3's 0.1636 (margin +0.0069, winning
9 of 10 cases); combined 14 cases 0.1476 vs 0.1537 (margin +0.0061).
The win holds at every set size tried (7, 8, 10 cases). The two other
v5 candidates did not clear the bar on the bigger set (shaped boost
+0.0017, flat boost + early-dip correction +0.0010 on the new set).
Leave-one-out over the practice cases (hyperparameters tuned on 3, tested
on the 4th): 0.131 vs v2's 0.139. Comparable-LOO (targets with hour-1
above 20k): 0.356 vs v2's 0.343 — the boost is a big-Western-launch
correction, and GTA VI is the biggest Western launch there is. Practice
is no guide to the final — but it is the only signal available before
submitting.

## Run

Node 22, standard library only, no network, deterministic:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```
