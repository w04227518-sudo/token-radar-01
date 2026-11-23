# Token Radar — pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/w04227518-sudo/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/w04227518-sudo/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for [make.fun's `token-radar-01` bounty](https://make.fun/bounty/token-radar-01). It reads the sealed
DefiLlama snapshot, ranks the protocols that record no token by what a launch would
be worth, and hands the reader a farm plan for each one.

## The model (radar-comps-1)

The base multiple is not a constant: for each category it is the **median
market-cap / TVL of the live-token protocols in that category**, computed from the
snapshot at runtime. A category with fewer than 3 live comps falls back to the
global median (x0.1689 on this snapshot), and every multiple is capped at x1.5.

```
implied = round( tvl_usd x baseMultiple
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.8 + min(age_days, 1095) / 1095 x 0.35)
                 x (1 + min(chains - 1, 4) x 0.03) )
```

Age is the time since the protocol was first listed — how long it has run with no
token issued (unknown age counts as 365 days). No protocol name is special-cased.
The dashboard prints the whole comps table, so every multiple can be checked
against the snapshot.

The board holds 200 rows: all 40 watchlist protocols plus the 160 largest
pre-token protocols below the $50M floor, by TVL. The 24 largest live-token
protocols are set aside in their own view with their market caps.

## The dashboard

A static, no-network page (`dashboard/`): a sortable, filterable board (search,
category, chain, watchlist-only, minimum TVL), a detail drawer for every protocol
with the model line by line and a six-step farm plan with cost and time per step,
a live-token comparison view, the comps table, and a model sandbox — three dials
that re-rank the board live in the page.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or later, standard library only. Two runs write identical bytes.

## Screenshots

The three screenshots (`screenshots/`: board, detail, filtered) are taken in a
browser from the built dashboard.

## License

MIT. See LICENSE.
