# Token Radar — pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/w04227518-sudo/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/w04227518-sudo/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for [make.fun's `token-radar-01` bounty](https://make.fun/bounty/token-radar-01). It reads the sealed
DefiLlama snapshot, ranks the protocols that record no token by what a launch would
be worth, and hands the reader a farm plan for each one.

## The model (radar-fitted-2)

A log-linear fit on the 101 live-token protocols that record a market cap and
TVL and are not exchanges or bridges. The target is log10(market cap / TVL) —
what the market pays for one dollar of TVL. Every term was kept or dropped on
held-out tests, not on in-sample fit:

```
log10(mcap / TVL) = 2.5330 - 0.2932 x log10(TVL) + 1.4092 x log10(category median)
implied = round( TVL x 10^log10(mcap / TVL) ), clamped to x0.0080 – x5.1301
```

The category median is the median market-cap / TVL of that category's
live-token protocols, shrunk toward the global median (x0.2042 on this
snapshot) by weight n / (n + 2), so a category with one comp cannot set the
board. Held-out validation, computed at runtime from this snapshot, is
reported two ways — as-fitted and honest. As-fitted builds the category
table once on all 101 comps, so a held-out protocol's own ratio leaks into
its prediction: leave-one-out error **x5.5765** (RMSE 0.7464 in log10),
walk-forward **x5.2189**, reverse walk-forward x4.5683; mean-absolute-error
multiples x3.6281 / x3.4131 / x2.8765 and median multiples x2.5722 / x2.1895 /
x2.0099. Honest rebuilds the table inside every fold and every split, so
nothing leaks: leave-one-out **x8.3275** (MAE x5.2019, median x3.9303),
walk-forward **x9.1681** (MAE x5.2663, median x2.9988), reverse walk-forward
x6.5968 (MAE x4.7563, median x4.4921). The RMSE multiples are pulled up by a
few protocols whose multiples sit orders of magnitude off their peers; the
median says what the model usually gets wrong. The 90% interval on each
implied value is priced per TVL band from the honest leave-one-out residuals:
<$100M x42.9243 (80 comps), $100M–$2B x14.3490 (17 comps), >$2B falls back to
the honest global factor x29.6095 (4 comps — too few to price alone). The old
single factor was x17.1784 as-fitted. Farm plans now also show cost per
active hour beside the total cost.

v5 changes nothing about the model — the same fitted coefficients, the same
board, the same verdicts. It only shows the validation honestly (as-fitted
beside honest, RMSE beside MAE beside median), prices the interval per TVL
band, and costs the farm plan per hour. A research pass over the snapshot
found no honestly better model: every direction tried (retargeting,
k-nearest neighbours, robust fits, extra features, tree models) landed
within noise of v4, and the ~x2–3 held-out errors in the leaders' titles
match median/MAE statistics on a leaky evaluation, not honest RMSE.

Term selection by leave-one-out error (full model x5.8998): **log_tvl kept**
(without it x6.2076) and **log_catmed kept** (without it x8.0821); **growth
dropped** (without it x5.7611), **log_age dropped** (x5.7475) and **chains
dropped** (x5.8193) — each of the three made held-out error worse when kept.

The comps leave out exchanges and bridges: an exchange's token prices its
whole exchange business, not the TVL on its DeFi product, and a bridge's TVL
is assets in transit, not value captured. Their market-cap / TVL ratios run
from 0.00025x to 69x — nearly six orders of magnitude — so they would set
the board's prices from businesses the board does not rank. The 101 comps
are the live-token protocols outside those four categories; the rule is over
categories, never names, and pre-token bridges are still ranked, on the
global median.

Launch odds come from a logistic fit on every protocol with a listing date:
launched (1) or not (0), on log age and the category's launched share (shrunk
toward the overall share 0.507 with prior weight 5). Coefficients: const
-7.9032, log age 1.8102, category share 5.753. Odds for a protocol are the
chance it launches in the next 5 years, given it has not launched by its
current age — so odds fall with age, and an old protocol can rank high on
value and still be a Watch. The farm verdict is Farm when both implied value
and odds sit above their board medians, Watch when one does, Skip when
neither does.

The board holds 261 rows: every pre-token protocol the snapshot holds, except
81 set aside with a reason — 42 exchanges, 11 versioned pools, 8 wrapped
assets, and 20 bridges a chain or an exchange runs itself. All 758 snapshot
protocols are accounted for: 261 ranked + 416 live-token protocols shown in
their own view + 81 set aside. All 40 watchlist slugs are covered. Top of the
board on this snapshot: Polymarket $1,314.3M (odds 31%), Sentora $602.0M (22%),
Steakhouse Financial $601.5M (21%), Gauntlet $405.7M (21%), nonce-capital
$183.6M (25%). No protocol name is special-cased, and no value is hardcoded: every
coefficient, multiple and odds figure is fitted from the snapshot at runtime.

## The dashboard

A static, no-network page (`dashboard/`): a sortable, filterable board (search,
category, chain, watchlist-only, minimum TVL) with launch odds, a 90% range and
a farm verdict on every row, a detail drawer for every protocol with the fitted
model line by line, launch odds and expected value, and a six-step farm plan
with cost and time per step, a live-token comparison view of all 416 live
protocols, the comps table, the term-selection and validation numbers, and a
model sandbox — a fitted-multiple scale and a rank-by-expected-value toggle
that re-rank the board live in the page. The cover carries an integrity strip:
coverage counts, validation stats, the kept terms, and the checks the board
passes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or later, standard library only. Two runs write identical bytes.

## Screenshots

Four screenshots (`screenshots/`): board, detail, filtered, and the model &
comps view, taken in a browser from the built dashboard.

## License

MIT. See LICENSE.
