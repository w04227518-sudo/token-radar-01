# Token Radar — pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/w04227518-sudo/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/w04227518-sudo/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for [make.fun's `token-radar-01` bounty](https://make.fun/bounty/token-radar-01). It reads the sealed
DefiLlama snapshot, ranks the protocols that record no token by what a launch would
be worth, and hands the reader a farm plan for each one.

## The model (radar-fitted-1)

A log-linear fit on the 128 live-token protocols that record a market cap and
TVL. The target is log10(market cap / TVL) — what the market pays for one
dollar of TVL. Every term was kept or dropped on held-out tests, not on
in-sample fit:

```
log10(mcap / TVL) = 2.3097 - 0.2880 x log10(TVL) + 1.1435 x log10(category median)
implied = round( TVL x 10^log10(mcap / TVL) ), clamped to x0.0065 – x12.1602
```

The category median is the median market-cap / TVL of that category's
live-token protocols, shrunk toward the global median (x0.2138 on this
snapshot) by weight n / (n + 2), so a category with one comp cannot set the
board. Held-out validation, computed at runtime from this snapshot:
leave-one-out error **x6.8139** (RMSE 0.8334 in log10, 128 comps),
walk-forward error **x6.0746** (fit on the older listings, scored on the 47
newer ones), reverse walk-forward x6.9601. The 90% interval on each implied
value is x26.3786, the 90th percentile of the leave-one-out residuals —
honestly wide, because market multiples span four orders of magnitude.

Term selection by leave-one-out error (full model x7.0667): **log_tvl kept**
(without it x7.5084) and **log_catmed kept** (without it x8.5927); **growth
dropped** (without it x7.0148), **log_age dropped** (x6.9363) and **chains
dropped** (x6.9759) — each of the three made held-out error worse when kept.

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
board on this snapshot: Polymarket $702.6M (odds 31%), Sentora $502.4M (22%),
Steakhouse Financial $502.0M (21%), Gauntlet $337.6M (21%), CCIP $309.4M
(57%). No protocol name is special-cased, and no value is hardcoded: every
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
