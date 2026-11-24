// pump-sprint-01: a tuned pump.fun launch sniper for agent-fun/replay/v2.
// The grader runs `node /bot/main.ts`. The trading rules live in strategy.ts and
// the wire protocol lives in the vendored shim vendor/agentfun-bot.ts.
//
// Sniper in one line: only buy a fresh launch once it already proves real demand
// (>= 4 trades and >= 3 SOL of real reserve inside its first 3 slots), risk 0.2 SOL
// per coin, take profit at +25%, cut at -8%, never hold longer than 10 slots.
// Tuning notes and backtest numbers: the strategy.ts header and README.md.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const sniper = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch: (state, batch) => sniper.onBatch(state, batch),
});
