# token-radar-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/herlienn/token-radar-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/herlienn/token-radar-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-2): a web dashboard that tracks pre-token crypto protocols and ranks them by implied value, with a concrete farm plan for each one. It reads a sealed DefiLlama snapshot, scores every rankable pre-token protocol, and writes a ranked board, a static dashboard and a dossier.

## How it works

The model scores all 198 rankable pre-token protocols in the snapshot: the 40-protocol watchlist plus every other pre-token protocol that is not a wrapped, staked or bridged product of a token that already trades. Implied value is `TVL x 0.22 x growth multiplier x maturity multiplier x breadth multiplier x category multiplier`, with seven-day growth clamped to -50%..+100% so one week's spike cannot buy the top of the board. Farm readiness (0-100) is a separate score for how farmable a protocol is now.

The dashboard is sortable and filterable by search, category, chain and watchlist membership, with a detail view for every protocol showing its model breakdown, what to watch, and its seven-step farm plan. Live-token protocols are set aside with their market caps, never mixed into the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

At grade time the program reads `/input/snapshot.json` and writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to `/output`. Open `out/dashboard/index.html` in a browser to use the dashboard; it needs no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=4a84jcbk&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
