// pump-sprint-01: a tuned pump.fun launch sniper for agent-fun/replay/v2.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts, the protocol in the
// vendored SDK shim (vendor/agentfun-bot.ts, a byte-identical copy of the kit's sdk/ts file).
//
// Strategy: buy a new launch only once it already shows real demand (>= 4 trades and
// >= 3 SOL real reserve in its first 3 slots), stake 0.2 SOL per coin, take profit at
// +25%, cut losses at -8%, never hold past 10 slots. See strategy.ts for the tuning
// notes and README.md for the backtest numbers.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
