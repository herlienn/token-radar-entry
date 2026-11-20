# Token Radar — radar-4

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/herlienn/token-radar-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/herlienn/token-radar-entry/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01): what would a protocol's token be worth if it launched today, and what should you do to farm it first?

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot of 758 DefiLlama protocols, fits a launch-value model on the 87 protocols whose token already trades, and ranks the 198 pre-token protocols by implied value. The dashboard (`dashboard/`) shows the board, the model and its blind tests, the comps, and the coverage accounting. Four screenshots in `screenshots/` show the board, the Model & tests tab, a protocol's detail view, and the Coverage tab.

## The model

```
log(implied) = b0 + b1*log(TVL) + b2*growth + b3*log(1+age) + b4*log(chains) + b5*ageUnknown
```

Fitted on 87 comps: traded tokens, not wrapped/staked/bridged products, one per ticker (largest TVL keeps it), mcap/TVL at most 10. Growth is the 7-day TVL change as a fraction, clamped −50%…+100%. A missing listing date is imputed to the comps' median age (893 days) and flagged. The fitted coefficients, R², and every test are printed by the program and shown on the Model & tests tab.

## Blind tests

- Leave-one-out median absolute log error **0.947**, against a flat median multiple (1.554) and a flat 0.22 (1.513) — **1.6× better than flat**.
- 5-fold cross-validation × 5 seeds, and walk-forward on three splits (fit older launches, test newer ones) — all shown on the Model & tests tab, with the flat comparison beside each.
- Rank bands from 200 bootstrap refits (p10–p90) on every row.

## Launch odds and expected value

Each row carries launch odds: the peer base rate — among non-wrapped protocols in the same age and size band, how many already have a token, shrunk toward the overall base rate so a small band cannot claim 0% or 100%. Expected value = implied value × launch odds. The board's rank stays by implied value.

## Farm plans

Every row carries a dated, costed plan: start date (the snapshot date), weekly cadence, hold-until (26 weeks), and a break-even date (when the expected value covers gas). Expected value assumes a 5% airdrop pool shared among TVL/$1,000 farmers, less gas on the protocol's cheapest chain. Verdicts: farm (net ≥ $25), thin ($0–$25), skip (negative). The board also shows a Best farms panel (top 5 by net) and an integrity strip (what the data does not say).

## Coverage

758 protocols, all accounted for: 198 ranked + 144 wrapped products excluded + 144 with a recorded market cap + 272 with a symbol but no market cap. Watchlist: 40/40 covered.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Two runs write the same bytes. The dashboard is static and needs no network; open `out/dashboard/index.html` (it reads `out/data.js`).

## Honest limits

The fit is noisy (R² 0.185): a single protocol's implied value is uncertain by roughly a factor of 2.6 either way. Walk-forward varies by split. Launch odds describe peers, not the protocol itself. Gas figures are November 2026 estimates. A protocol that records no token may still have one its DefiLlama record does not carry.
