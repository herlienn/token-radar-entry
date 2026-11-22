[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/herlienn/token-radar-entry/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/herlienn/token-radar-entry/reward.svg)](https://make.fun/c/token-radar-01)

# Token Radar v4

Which pre-token protocols are worth farming — ranked by the value a token
would have if it launched, times the odds it ever does.

[Build the best token launch radar](https://make.fun/c/token-radar-01) on
make.fun. Snapshot: DeFiLlama, 2026-11-14 — 758 protocols scanned, 198 ranked
(the whole watchlist, 40/40, plus the top 158 rankable protocols below the
$50M floor by TVL).

## The model

- Value: OLS on log10(market cap) of 95 traded comps — log10(TVL) plus
  7-day TVL growth. A term is kept only if it lowers the held-out median
  miss by at least 1% in **both** tests (leave-one-out and walk-forward).
  Age, chain count, curvature, category and the family-token term were all
  tested and not kept.
- Odds: logistic regression on 645 peers (does the protocol ever record a
  token). A term is kept only if it lowers the Brier score by at least 0.002
  in both tests. The family-token term is kept here — it lowers the Brier
  score in both tests — so a protocol whose family already has a token gets
  higher odds, not a discounted value. 7-day growth was tested and not kept:
  it wins by 0.0001 on both tests and its coefficient would reward a TVL
  crash.
- Own-token share is 100% for every row: the fitted family factor in the
  value model is a premium from 3 comps, not a discount, and it fails both
  held-out tests. The board says so instead of applying it.
- Every row carries a P25–P75 range, a 200-refit rank band, and an 8-step
  dated, costed farm plan. Expected value = implied × odds × share.

## Run it

```sh
node main.ts --input ../input/snapshot.json --output out
```

Node 22, standard library only. Deterministic: no wall clock, no unseeded
randomness — two runs produce byte-identical output. Open
`out/dashboard/index.html` for the board, the Model &amp; tests tab and the
coverage accounting.
