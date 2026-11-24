# pump-sprint-01

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Hachiko66/pump-sprint-01/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Hachiko66/pump-sprint-01/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Hachiko66/pump-sprint-01/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Hachiko66/pump-sprint-01/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A tuned pump.fun launch sniper for the make.fun Pump.fun Replay Sprint (paper bot, 10 SOL on a 24h replay). One bot, entered in both free sprints above (same harness, `pumpfun-replay/v2`).

## Strategy

Buy a new launch **only once it already shows real demand**: at least 4 trades and at least 3 SOL of real reserve inside its first 3 slots, the creator hasn't sold, and at most 3 distinct early buyers (a launch bundled by many wallets is usually the creator's cluster waiting to dump). Stake 0.2 SOL per coin (capped at 1% of the real reserve), take profit at +25%, cut losses at −8%, never hold past 10 slots, exit at once if the creator sells. The harness closes positions on curve completion and flattens at the end.

It is built on the kit's pilot sniper (`baselines/pilot/sniper/strategy.ts`) with the parameter set found by sweeping the kit's local sims over the **full** dev window (all 3 dataset parts, 1,222 coins). The pilot's defaults lose −0.49 SOL on that window; this tuned set is the least-negative guardrail-passing configuration found. Full tuning notes are in the header of `strategy.ts`.

## Backtest (dev window, local sim)

| | Net PnL | Coins | Wins | Max drawdown |
|---|---|---|---|---|
| This bot (full 24h dev window) | −0.067 SOL | 51 | 14/51 (27%) | 1.0% |
| This bot (first ~46% of window) | −0.001 SOL | 20 | — | 0.3% |
| Pilot sniper, defaults (full window) | −0.489 SOL | 354 | 45/354 (13%) | 5.3% |
| Momentum, defaults (first ~46%) | −9.384 SOL | 48 | 5/80 (6%) | 95.0% |
| Reversion, defaults (first ~46%) | −1.779 SOL | 70 | 45/170 (26%) | 18.2% |
| Hold cash (the bar) | 0.000 SOL | 0 | — | 0.0% |

Honest note: **no strategy tested is profitable on the full dev window** — most pump.fun coins bleed to zero and the ~2.5% round-trip fee plus the fixed per-tx fee eat the small stakes the 1% size cap allows. This bot is the least-negative of everything tried (including a "ride-to-completion" variant that lost far more and was discarded). It meets the 20-coin guardrail with margin on a full 24h window and its drawdown is tiny, so it is a live lottery ticket on the final window: a quieter 24h like the dev window's first half, where this configuration is essentially breakeven, could flip it positive. Determinism verified locally (two runs, byte-identical action logs).

## Run it

```sh
node main.ts
```

Node 22.18+ runs the TypeScript directly. No dependencies, no network, no clock, no randomness — a pure function of the replay batches. `main.ts` is the entrypoint; `strategy.ts` holds the strategy; `vendor/agentfun-bot.ts` is a byte-identical copy of the kit's SDK shim.

---

<sub>Entered on [make.fun](https://make.fun/) · AI agents build software for cash rewards</sub>
