# Token Radar — radar-3

A pre-token radar whose values come from a curve fitted on the tokens that
already trade, not from a flat multiple. The previous board (radar-2) used
`TVL × 0.22` for every protocol and ranked 7,576th of 12,753. The top boards
all fit their pricing from traded tokens, so this one does the same — and
shows the blind tests that prove the fitted curve beats the flat one.

## The model

- **Training set (comps): 87 traded tokens.** One observation per ticker
  (multi-chain clones count once, larger TVL kept). Wrapped / re-badged
  products (bridges, liquid staking/restaking, CEXs, versioned clones) and
  the 4 tokens whose market cap is more than 10× their TVL are excluded.
  16 tokens have market cap ≤ 0 and cannot be fitted.
- **Curve (log-log OLS):**
  `log(implied) = b0 + b1·log(TVL) + b2·growth + b3·log(1+age) + b4·log(chains) + b5·ageUnknown`
  Growth is the 7-day TVL change clamped to −50%…+100%. Age is days since
  DefiLlama first tracked the protocol; when it is missing the median comp
  age is used and the flag is set. Category dummies were tried and dropped:
  they overfit (leave-one-out error 0.95 → 1.19+).
- **Blind tests (median absolute log error):** leave-one-out fitted 0.95 vs
  flat median-ratio 1.58 vs flat 0.22 1.51; walk-forward (fit the older half,
  test the newer half) fitted 0.74 vs flat 1.50. The fitted curve beats the
  flat multiple out of sample on both tests.
- **Rank ranges:** 200 bootstrap refits (seeded, deterministic) give a
  p10–p90 rank band per protocol, shown on the board.
- **Farm verdict:** a 5% farmer pool is assumed, split equally among an
  estimated `TVL / $1,000` farmers; gas is 4 transactions on the cheapest
  chain the protocol lists. `net = pool share − gas`: farm if net > $5,
  thin if net > $0, skip otherwise. The deposit is capital, not cost — it
  comes back when you exit. Rank is the size of the prize; verdict is what
  one farmer nets after gas.

## Coverage

All 758 snapshot protocols are accounted for: 198 ranked (40 watchlist +
158 other pre-token), 144 pre-token but wrapped / re-badged and excluded,
144 with a market cap, 272 with a token symbol but no market cap.

## Honest limits

The snapshot has no launch dates, no launch prices, no FDV and no token
supply. `listed_at` is when DefiLlama first tracked the protocol, not when
its token launched — so "walk-forward" splits by tracking start, a proxy,
not by true launch order. Market cap is today's value, not the value at
launch. Implied value is a fitted median over traded tokens, not a forecast
of any launch. Gas prices and the 5% pool / $1,000-farmer assumptions are
stated rules, not quotes.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` (last, via the vendored make.fun library). Two runs are
byte-identical: the only randomness is a seeded bootstrap.

## Files

- `main.ts` — reads the snapshot, writes the outputs, checks the board.
- `lib/radar.ts` — parsing, comps, the fit, the blind tests, the bootstrap,
  the board, the farm plans, the gate checks.
- `vendor/makefun-board.ts` — the scorer's own dossier library, copied
  unchanged from the kit.
- `dashboard/` — static page, no network: board, model & tests, comps,
  coverage. `index.html` + `app.css` + `app.js`.
- `screenshots/` — board, detail, filtered view.
- `scripts/check.mjs` — the local gate (7 rows) against an output directory.
