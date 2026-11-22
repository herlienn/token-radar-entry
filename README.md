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

- Value: OLS on log10(market cap) of 89 traded comps — log10(TVL) only.
  The 89 come from an explicit cleaning policy (stated on the Model tab):
  traded (416) → usable cap (128) → dated (95) → not wrapped / staked /
  versioned (94, drops astar-dapps-staking) → one per ticker (94) → mcap /
  TVL ≤ 10 (89, drops bitway-earn, anvil, nexo, flokifi-locker, rain). A
  term is kept only if it lowers the held-out median miss by at least 1% in
  **both** tests (leave-one-out and walk-forward, the mean of three splits
  at train fractions 0.5 / 0.6 / 0.4), and the result is checked against
  5-fold cross-validation (×2.71) and a 200-split win share. 7-day TVL
  growth was tested and not kept: it improves LOO (×2.53 vs a ×2.64 base)
  but not walk-forward (×3.08 vs ×3.05), its win share is 52%, and its
  coefficient is 0.47 ± 0.86 — not distinguishable from noise. Age, chain
  count, curvature, category and the family-token term were all tested and
  not kept. The control row (another row's growth) passes both headline
  tests on these 89 comps — the median miss is noisy at this size, which is
  why the win share is shown next to every term.
- Odds: logistic regression on 645 peers (does the protocol ever record a
  token). A term is kept only if it lowers the Brier score by at least 0.002
  in both tests (LOO 0.167, walk-forward 0.179, 5-fold CV 0.169, against a
  base rate of 0.250). The family-token term is kept here — it lowers the
  Brier score in both tests — so a protocol whose family already has a token
  gets higher odds, not a discounted value. 7-day growth was tested and not
  kept: it improves the Brier score by about 0.0002–0.0003 on both tests,
  below the 0.002 margin, and its coefficient is −1.17, so keeping it would
  reward a TVL crash.
- Own-token share is 100% for every row: the fitted family factor in the
  value model is a premium from 3 comps (+0.65 ± 0.30), not a discount, and
  it fails both held-out tests. The board says so instead of applying it.
- Farm verdict: a flat $2,000 stake per farm; the drop pool is 7% of the
  expected value and the farmer's share is the deposit as a fraction of TVL
  (every TVL dollar earns points pro-rata — the conservative end, since a
  smaller eligible pool would only raise the share); costs are fixed gas
  only, $11 ($5 wallet funding + $2.50 deposit + $1.50 claim + $2.00 exit);
  the plan is deposit + hold + claim over 52 weeks, no weekly paid action.
  FARM means the expected drop beats the gas by at least $10. Result on
  this board: 26 FARM / 58 MARGINAL / 114 SKIP, with a sensitivity table on
  the Model tab (a $1,000 stake leaves 2 FARM; a weekly $2 action leaves 4).
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
