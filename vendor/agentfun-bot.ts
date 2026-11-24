// agent-fun/replay/v2: the wire shim between a strategy and the replay harness.
//
// A strategy should not have to know how the harness talks. This file owns that part:
// it is dependency-free TypeScript that runs under the grader's fixed command
// `node /bot/main.ts` (Node 22 erases the types on the fly, so there is no build step
// and nothing to install). Copy it into your bot repository as vendor/agentfun-bot.ts
// and hand your strategy to runBot:
//
//   import { runBot, LAMPORTS_PER_SOL } from './vendor/agentfun-bot.ts';
//
//   await runBot({
//     onHello(state) {},               // optional: once, after hello, before the first batch
//     onBatch(state, batch) {          // once per batch: decide this slot's orders
//       return [{ side: 'buy', mint, quote_lamports: LAMPORTS_PER_SOL / 20n, max_slippage_bps: 500 }];
//     },
//     onDone(state, done) {},          // optional: once, at the end; nothing is replied
//   });
//
// The shim reads a single JSON line at a time from stdin (a line may be at most
// MAX_HARNESS_LINE_BYTES), keeps `state` current (cash, positions, the latest reserves of
// every curve, the orders still waiting for a fill), calls onBatch, and writes exactly one
// reply per batch (at most MAX_BOT_LINE_BYTES), carrying that batch's seq, before reading
// the next line. Amounts may come in as bigint, as a u64 decimal string, or as a safe
// integer; the shim sends them out as decimal strings and makes up a client_id when you
// leave one out. An order the harness would call a protocol violation (a malformed mint,
// amount, slippage or client_id, a client_id that starts with `_`, an unknown key, a reply
// line past the size limit) raises OrderError right here, so a broken bot fails on your
// own machine instead of in grading. The same applies to a reply with more orders than
// hello.caps.max_orders_per_batch: the harness drops the excess and fails the run when a
// reply is far over the cap. Orders the market turns down (position and size limits, cash,
// slippage) are not errors: they come back in a later batch's fills as "rejected", with a
// reason attached.
//
// Two market facts worth keeping in mind while sizing orders: the buys on one coin inside
// a single reply share one size cap (state.maxBuyLamports), and your own fills on one coin
// in one slot move the reserves for each other, so splitting an order never buys a better
// price than sending it whole.
//
// Only replies go to stdout: put diagnostics on stderr (console.error). Determinism: each
// entry is executed twice and the two action logs must agree byte for byte, so never read
// the clock, the environment, or Math.random; if you need randomness, seed it from
// state.hello.seed.

export const PROTOCOL = 'agent-fun/replay/v2';
/** Harness -> bot lines (hello, batch, done) are at most this long in UTF-8 bytes, newline not counted (1 MiB). */
export const MAX_HARNESS_LINE_BYTES = 1_048_576;
/** Bot -> harness lines (replies) are at most this long in UTF-8 bytes, newline not counted (64 KiB). */
export const MAX_BOT_LINE_BYTES = 65_536;
export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const LAMPORTS_PER_SOL = 1_000_000_000n;
/** 10_000 bps is one unit: 10_000 bps = 100%. */
export const BPS = 10_000n;
export const U64_MAX = 18_446_744_073_709_551_615n;

// ---------------------------------------------------------------- wire types (contracts/protocol.ts)

/** A u64 written as a canonical decimal string; turn it back with BigInt. */
export type U64 = string;
/** An i64 written as a canonical decimal string. */
export type I64 = string;
/** A base58 Solana address. */
export type Pubkey = string;

export interface Universe {
  program: typeof PUMP_PROGRAM_ID;
  quote: 'SOL';
  /** Mayhem-mode coins (a CreateEvent with is_mayhem_mode) are never sent to the bot. */
  mayhem: 'excluded';
  /** Cashback coins (a CreateEvent with is_cashback_enabled) are never sent to the bot. */
  exclude_cashback: true;
  /** A mint belongs iff sha256 of its base58 form, read as a big-endian integer, mod modulus is residue. */
  sample: { hash: 'sha256'; modulus: number; residue: number };
}

export interface Caps {
  max_open_positions: number;
  /**
   * The buys on one mint in one reply may together spend at most this fraction (bps) of that
   * mint's real SOL reserve at decision time; walking the reply in order, a buy that would push
   * the total over it is refused (reason max_order_size) and does not add to the total.
   */
  max_order_bps_of_real_reserve: number;
  /**
   * Orders past this count in one reply are refused (reason max_orders_per_batch). This shim
   * refuses the whole reply instead of sending it: onBatch returning more raises OrderError.
   */
  max_orders_per_batch: number;
  shorts: false;
  leverage: false;
}

export interface Fees {
  protocol_bps_fallback: number;
  creator_bps_fallback: number;
  base_fee_lamports: U64;
  priority_fee_lamports: U64;
  /** The share of orders whose transaction fails (seeded), in bps. */
  failed_tx_bps: number;
}

export interface Hello {
  type: 'hello';
  protocol: typeof PROTOCOL;
  /** This run's seed (u64): the only randomness a bot is allowed to use. */
  seed: U64;
  universe: Universe;
  capital: { lamports: U64 };
  caps: Caps;
  /** An order decided on the batch for slot s fills at slot s + latency_slots. */
  latency_slots: number;
  fees: Fees;
}

export interface Shareholder {
  address: Pubkey;
  share_bps: number;
}

/** The fields the collector stamps onto every decoded event. */
export interface ChainMeta {
  slot: number;
  signature: string;
  block_time: number | null;
  /** Where the event sits in its mint's event chain, 0-based. */
  chain_seq: number;
}

/** One trade on a curve. Reserves are after the trade; on SOL curves use the *_quote_* fields. */
export interface TradeEventRecord extends ChainMeta {
  event: 'TradeEvent';
  mint: Pubkey;
  sol_amount: U64;
  token_amount: U64;
  is_buy: boolean;
  user: Pubkey;
  timestamp: I64;
  virtual_sol_reserves: U64;
  virtual_token_reserves: U64;
  real_sol_reserves: U64;
  real_token_reserves: U64;
  fee_recipient: Pubkey;
  fee_basis_points: U64;
  fee: U64;
  creator: Pubkey;
  creator_fee_basis_points: U64;
  creator_fee: U64;
  track_volume: boolean;
  total_unclaimed_tokens: U64;
  total_claimed_tokens: U64;
  current_sol_volume: U64;
  last_update_timestamp: I64;
  ix_name: string;
  mayhem_mode: boolean;
  cashback_fee_basis_points: U64;
  cashback: U64;
  buyback_fee_basis_points: U64;
  buyback_fee: U64;
  shareholders: Shareholder[];
  quote_mint: Pubkey;
  quote_amount: U64;
  virtual_quote_reserves: U64;
  real_quote_reserves: U64;
  holder_rewards_bps: U64;
  holder_rewards: U64;
  creator_fee_unclaimed: U64;
}

/** A curve was created: its opening reserves (real SOL starts at 0). */
export interface CreateEventRecord extends ChainMeta {
  event: 'CreateEvent';
  name: string;
  symbol: string;
  uri: string;
  mint: Pubkey;
  bonding_curve: Pubkey;
  user: Pubkey;
  creator: Pubkey;
  timestamp: I64;
  virtual_token_reserves: U64;
  virtual_sol_reserves: U64;
  real_token_reserves: U64;
  token_total_supply: U64;
  token_program: Pubkey;
  is_mayhem_mode: boolean;
  is_cashback_enabled: boolean;
  quote_mint: Pubkey;
  virtual_quote_reserves: U64;
  creator_fee_bps: U64;
  is_holder_reward: boolean;
  depth: number;
}

/** The curve finished (migrated): it can no longer be traded and its positions are closed. */
export interface CompleteEventRecord extends ChainMeta {
  event: 'CompleteEvent';
  user: Pubkey;
  mint: Pubkey;
  bonding_curve: Pubkey;
  timestamp: I64;
  quote_mint: Pubkey;
}

export type ChainEvent = TradeEventRecord | CreateEventRecord | CompleteEventRecord;

/** The newest post-trade reserves of a mint the bot holds or has a pending order in. */
export interface Mark {
  mint: Pubkey;
  /** The slot of the trade these reserves come after. */
  slot: number;
  virtual_token_reserves: U64;
  virtual_quote_reserves: U64;
  real_token_reserves: U64;
  real_quote_reserves: U64;
}

export interface Position {
  mint: Pubkey;
  token_amount: U64;
  /** SOL spent on the tokens still held, fees included. */
  cost_lamports: U64;
}

export interface Account {
  cash_lamports: U64;
  positions: Position[];
}

export type Side = 'buy' | 'sell';

export const REJECT_REASONS = [
  'max_slippage',
  'max_open_positions',
  'max_order_size',
  'max_orders_per_batch',
  'insufficient_cash',
  'insufficient_tokens',
  'not_in_universe',
  'token_complete',
  'zero_amount',
  'duplicate_client_id',
  'after_end',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/**
 * What happened to an order: filled, rejected (nothing paid) or failed (tx fees paid, nothing
 * traded). The harness's own closes also arrive as sell fills, with client_id `_complete_<n>`
 * (the curve completed), `_flatten_<n>` (the replay ended) or `_writeoff_<n>` (closing would
 * not have covered its tx fees: the tokens are written off, quote_lamports "0").
 */
export interface Fill {
  /** Your order's client_id, or a harness close's (`_complete_<n>`, `_flatten_<n>`, `_writeoff_<n>`). */
  client_id: string;
  mint: Pubkey;
  side: Side;
  status: 'filled' | 'rejected' | 'failed';
  /** Present exactly when status is rejected. */
  reason: RejectReason | null;
  /** The slot of the batch the order was decided on. */
  decided_slot: number;
  /** The slot it resolved at. */
  slot: number;
  /** Buy: SOL spent, fees included. Sell: SOL received, fees taken out. "0" unless filled. */
  quote_lamports: U64;
  /** Buy: tokens received. Sell: tokens sold. "0" unless filled. */
  token_amount: U64;
  fee_lamports: U64;
  tx_fee_lamports: U64;
  fee_fallback: boolean;
}

export interface Batch {
  type: 'batch';
  seq: number;
  slot: number;
  /** This slot's universe events, in chain order. */
  events: ChainEvent[];
  marks: Mark[];
  /** Orders resolved since the previous batch, in resolution order. */
  fills: Fill[];
  /** The account after those fills. */
  account: Account;
}

export interface Done {
  type: 'done';
  seq: number;
  reason: 'end_of_data' | 'aborted';
  /** The final account, after flattening. */
  account: Account;
}

export type HarnessMessage = Hello | Batch | Done;

export interface BuyOrder {
  side: 'buy';
  client_id: string;
  mint: Pubkey;
  /** SOL to spend, curve fees included. */
  quote_lamports: U64;
  max_slippage_bps: number;
}

export interface SellOrder {
  side: 'sell';
  client_id: string;
  mint: Pubkey;
  token_amount: U64;
  max_slippage_bps: number;
}

export type Order = BuyOrder | SellOrder;

export interface Reply {
  type: 'reply';
  seq: number;
  orders: Order[];
}

// ---------------------------------------------------------------- what onBatch returns

/** A bigint, a u64 decimal string, or a non-negative safe integer. */
export type Amount = bigint | string | number;

export interface BuyInput {
  side: 'buy';
  mint: Pubkey;
  /** SOL to spend, curve fees included. */
  quote_lamports: Amount;
  /** Refuse the fill when its outcome is worse than the decision-time reserves imply by more than this. */
  max_slippage_bps: number;
  /**
   * 1-64 characters from [A-Za-z0-9_-], never starting with `_` (that prefix belongs to the
   * harness's closes), unique across the run; the shim hands out one (o1, o2, ...) when omitted.
   */
  client_id?: string;
}

export interface SellInput {
  side: 'sell';
  mint: Pubkey;
  /** Tokens to sell. */
  token_amount: Amount;
  max_slippage_bps: number;
  /** Same rule as on a buy: never starting with `_`, unique in the run, assigned when omitted. */
  client_id?: string;
}

export type OrderInput = BuyInput | SellInput;

// ---------------------------------------------------------------- errors

/** The harness sent something this shim cannot follow (wrong protocol, a bad line, messages out of order). */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** The bot handed back something the harness would call a protocol violation. */
export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderError';
  }
}

// ---------------------------------------------------------------- state

/** A bonding curve the bot has seen, at the latest reserves it knows. */
export interface Curve {
  readonly mint: Pubkey;
  /** The slot of its CreateEvent; null when the shim first met the mint through a trade or a mark. */
  created_slot: number | null;
  virtual_token_reserves: bigint;
  virtual_quote_reserves: bigint;
  real_token_reserves: bigint;
  real_quote_reserves: bigint;
  /** The slot of the trade the reserves follow (the create slot until the first trade). */
  reserves_slot: number;
  /** TradeEvents seen on it. */
  trades: number;
  /** Its CompleteEvent arrived: no more orders (they would come back token_complete). */
  complete: boolean;
}

/** A position as the latest account reports it. */
export interface Holding {
  token_amount: bigint;
  cost_lamports: bigint;
}

/** An order that was sent and has not yet come back in a fill. */
export interface PendingOrder {
  readonly order: Order;
  /** The seq and slot of the batch it was decided on. */
  readonly seq: number;
  readonly decided_slot: number;
}

const U64_TEXT = /^(0|[1-9][0-9]{0,19})$/;
const BASE58_TEXT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** 1-64 characters from [A-Za-z0-9_-], not starting with `_`: ids starting with `_` are the harness's closes. */
const ORDER_ID_TEXT = /^[A-Za-z0-9-][A-Za-z0-9_-]{0,63}$/;

/**
 * Everything the bot knows, refreshed by runBot before every callback. You can also drive it
 * by hand to unit-test a strategy: `const s = new BotState(hello); s.applyBatch(batch); onBatch(s, batch)`.
 */
export class BotState {
  readonly hello: Hello;
  /** The seq of the batch being answered (-1 before the first batch). */
  seq = -1;
  /** The slot of the batch being answered (-1 before the first batch). */
  slot = -1;
  /** The account as of the latest batch (or done). */
  account: Account;
  /** account.cash_lamports as a bigint. Pending orders are not deducted yet: see freeCashLamports. */
  cash: bigint;
  /** Positions that hold tokens, keyed by mint. */
  readonly positions = new Map<Pubkey, Holding>();
  /** Every curve seen, keyed by mint, in first-seen order. */
  readonly curves = new Map<Pubkey, Curve>();
  /** Orders sent and not yet reported in a fill, keyed by client_id, in send order. */
  readonly pending = new Map<string, PendingOrder>();
  #usedIds = new Set<string>();
  #nextNum = 1;

  constructor(hello: Hello) {
    this.hello = hello;
    this.account = { cash_lamports: hello.capital.lamports, positions: [] };
    this.cash = BigInt(hello.capital.lamports);
  }

  /** A fresh client_id (o1, o2, ...), never one already spent in this run and never starting with `_`. */
  clientId(): string {
    const fresh = this.#mintId(null);
    this.#usedIds.add(fresh);
    return fresh;
  }

  /** The base + priority fee every sent order pays, filled or not. */
  txFeeLamports(): bigint {
    const base = BigInt(this.hello.fees.base_fee_lamports);
    const prio = BigInt(this.hello.fees.priority_fee_lamports);
    return base + prio;
  }

  /**
   * The size cap on this mint right now: the most this batch's buys on it may spend in total
   * (the sum of their quote_lamports); 0n when the mint is unknown or complete.
   */
  maxBuyLamports(mint: Pubkey): bigint {
    const curve = this.curves.get(mint);
    if (curve === undefined) return 0n;
    if (curve.complete) return 0n;
    const share = BigInt(this.hello.caps.max_order_bps_of_real_reserve);
    return (curve.real_quote_reserves * share) / BPS;
  }

  /** Mints held plus mints with a buy pending: what counts toward caps.max_open_positions. */
  committedPositionCount(): number {
    const seen = new Set<Pubkey>(this.positions.keys());
    for (const pend of this.pending.values()) {
      if (pend.order.side === 'buy') seen.add(pend.order.mint);
    }
    return seen.size;
  }

  /** Cash less what the pending orders would take if they all filled (buy amounts plus every tx fee). May go negative. */
  freeCashLamports(): bigint {
    const fee = this.txFeeLamports();
    let left = this.cash;
    for (const pend of this.pending.values()) {
      left -= fee;
      if (pend.order.side === 'buy') left -= BigInt(pend.order.quote_lamports);
    }
    return left;
  }

  /** Fold a batch in: its fills, then its account, marks and events, in that order. runBot calls this. */
  applyBatch(batch: Batch): void {
    this.seq = batch.seq;
    this.slot = batch.slot;
    for (const fill of batch.fills) this.pending.delete(fill.client_id);
    this.#syncAccount(batch.account);
    for (const mark of batch.marks) {
      const known = this.curves.get(mark.mint);
      if (known !== undefined && mark.slot < known.reserves_slot) continue;
      const curve = known ?? this.#newCurve(mark.mint, null, mark.slot);
      curve.virtual_token_reserves = BigInt(mark.virtual_token_reserves);
      curve.virtual_quote_reserves = BigInt(mark.virtual_quote_reserves);
      curve.real_token_reserves = BigInt(mark.real_token_reserves);
      curve.real_quote_reserves = BigInt(mark.real_quote_reserves);
      curve.reserves_slot = mark.slot;
    }
    for (const ev of batch.events) {
      switch (ev.event) {
        case 'CreateEvent': {
          const curve = this.#newCurve(ev.mint, ev.slot, ev.slot);
          curve.virtual_token_reserves = BigInt(ev.virtual_token_reserves);
          curve.virtual_quote_reserves = BigInt(ev.virtual_quote_reserves);
          curve.real_token_reserves = BigInt(ev.real_token_reserves);
          curve.real_quote_reserves = 0n;
          break;
        }
        case 'TradeEvent': {
          const curve = this.curves.get(ev.mint) ?? this.#newCurve(ev.mint, null, ev.slot);
          curve.virtual_token_reserves = BigInt(ev.virtual_token_reserves);
          curve.virtual_quote_reserves = BigInt(ev.virtual_quote_reserves);
          curve.real_token_reserves = BigInt(ev.real_token_reserves);
          curve.real_quote_reserves = BigInt(ev.real_quote_reserves);
          curve.reserves_slot = ev.slot;
          curve.trades += 1;
          break;
        }
        default: {
          const curve = this.curves.get(ev.mint) ?? this.#newCurve(ev.mint, null, ev.slot);
          curve.complete = true;
          break;
        }
      }
    }
  }

  /** Fold the final account in. runBot calls this before onDone. */
  applyDone(done: Done): void {
    this.seq = done.seq;
    this.#syncAccount(done.account);
  }

  /**
   * Check what onBatch gave back and turn it into wire orders (filling in missing client_ids).
   * Raises OrderError on anything the harness would call a protocol violation, and on more
   * orders than hello.caps.max_orders_per_batch. The orders are not recorded here.
   */
  toOrders(result: unknown): Order[] {
    if (result === undefined || result === null) return [];
    if (!Array.isArray(result)) {
      throw new OrderError(`batch ${this.seq}: onBatch must return an array of orders, got ${describe(result)}`);
    }
    const limit = this.hello.caps.max_orders_per_batch;
    if (result.length > limit) {
      throw new OrderError(
        `batch ${this.seq}: onBatch returned ${result.length} orders, over hello.caps.max_orders_per_batch (${limit}); ` +
          `the harness rejects the orders past the cap and fails the run on a reply far over it, so send at most ${limit} per batch`,
      );
    }
    const checked = result.map((raw: unknown, idx: number) => checkOrder(raw, `batch ${this.seq} order ${idx}`));
    const used = new Set<string>();
    for (const one of checked) {
      if (one.client_id !== undefined) used.add(one.client_id);
    }
    const out: Order[] = [];
    for (const one of checked) {
      const client_id = one.client_id ?? this.#mintId(used);
      used.add(client_id);
      if (one.side === 'buy') {
        out.push({ side: 'buy', client_id, mint: one.mint, quote_lamports: one.amount, max_slippage_bps: one.max_slippage_bps });
      } else {
        out.push({ side: 'sell', client_id, mint: one.mint, token_amount: one.amount, max_slippage_bps: one.max_slippage_bps });
      }
    }
    return out;
  }

  /** Note orders as sent on the current batch: they stay in `pending` until a fill reports them. */
  recordOrders(orders: readonly Order[]): void {
    for (const sent of orders) {
      this.#usedIds.add(sent.client_id);
      this.pending.set(sent.client_id, { order: sent, seq: this.seq, decided_slot: this.slot });
    }
  }

  #mintId(extra: Set<string> | null): string {
    for (;;) {
      const id = `o${this.#nextNum++}`;
      if (this.#usedIds.has(id)) continue;
      if (extra !== null && extra.has(id)) continue;
      return id;
    }
  }

  #newCurve(mint: Pubkey, born: number | null, at: number): Curve {
    const curve: Curve = {
      mint,
      created_slot: born,
      virtual_token_reserves: 0n,
      virtual_quote_reserves: 0n,
      real_token_reserves: 0n,
      real_quote_reserves: 0n,
      reserves_slot: at,
      trades: 0,
      complete: false,
    };
    this.curves.set(mint, curve);
    return curve;
  }

  #syncAccount(acc: Account): void {
    this.account = acc;
    this.cash = BigInt(acc.cash_lamports);
    this.positions.clear();
    for (const pos of acc.positions) {
      const amt = BigInt(pos.token_amount);
      if (amt <= 0n) continue;
      this.positions.set(pos.mint, { token_amount: amt, cost_lamports: BigInt(pos.cost_lamports) });
    }
  }
}

interface CheckedOrder {
  side: Side;
  client_id: string | undefined;
  mint: Pubkey;
  amount: U64;
  max_slippage_bps: number;
}

const BUY_KEYS = new Set(['side', 'client_id', 'mint', 'quote_lamports', 'max_slippage_bps']);
const SELL_KEYS = new Set(['side', 'client_id', 'mint', 'token_amount', 'max_slippage_bps']);

function checkOrder(raw: unknown, at: string): CheckedOrder {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new OrderError(`${at}: expected an order object, got ${describe(raw)}`);
  }
  const rec = raw as Record<string, unknown>;
  if (rec.side !== 'buy' && rec.side !== 'sell') {
    throw new OrderError(`${at}: side must be "buy" or "sell", got ${describe(rec.side)}`);
  }
  const keys = rec.side === 'buy' ? BUY_KEYS : SELL_KEYS;
  for (const key of Object.keys(rec)) {
    if (keys.has(key)) continue;
    throw new OrderError(`${at}: unknown key "${key}" on a ${rec.side} order`);
  }
  if (typeof rec.mint !== 'string' || !BASE58_TEXT.test(rec.mint)) {
    throw new OrderError(`${at}: mint must be a base58 address, got ${describe(rec.mint)}`);
  }
  const field = rec.side === 'buy' ? 'quote_lamports' : 'token_amount';
  const amt = toU64(rec[field], `${at}: ${field}`);
  const slip = rec.max_slippage_bps;
  if (typeof slip !== 'number' || !Number.isInteger(slip) || slip < 0 || slip > 10_000) {
    throw new OrderError(`${at}: max_slippage_bps must be an integer 0..10000, got ${describe(slip)}`);
  }
  let cid: string | undefined;
  if (rec.client_id !== undefined) {
    if (typeof rec.client_id !== 'string' || !ORDER_ID_TEXT.test(rec.client_id)) {
      throw new OrderError(`${at}: client_id must be 1-64 of [A-Za-z0-9_-] not starting with _ (reserved for the harness's closes), got ${describe(rec.client_id)}`);
    }
    cid = rec.client_id;
  }
  return { side: rec.side, client_id: cid, mint: rec.mint, amount: amt, max_slippage_bps: slip };
}

/** Turn an amount into a canonical u64 decimal string; raises OrderError when it is not one. */
export function toU64(raw: unknown, label = 'amount'): U64 {
  let num: bigint | null = null;
  if (typeof raw === 'bigint') {
    num = raw;
  } else if (typeof raw === 'number' && Number.isSafeInteger(raw)) {
    num = BigInt(raw);
  } else if (typeof raw === 'string' && U64_TEXT.test(raw)) {
    num = BigInt(raw);
  }
  if (num === null || num < 0n || num > U64_MAX) {
    throw new OrderError(`${label} must be a u64 (bigint, decimal string or safe integer), got ${describe(raw)}`);
  }
  return num.toString();
}

function describe(v: unknown): string {
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'string') {
    const shown = v.length > 80 ? `${v.slice(0, 77)}...` : v;
    return JSON.stringify(shown);
  }
  if (v === null || typeof v !== 'object') return String(v);
  return Array.isArray(v) ? 'an array' : 'an object';
}

// ---------------------------------------------------------------- the line loop

/**
 * Chop a byte stream into lines (`\n`-terminated, with a trailing `\r` dropped), each decoded
 * as strict UTF-8. A line longer than limit raises ProtocolError; a final line without a
 * terminator is still yielded.
 */
export async function* readLines(src: AsyncIterable<Uint8Array | string>, limit = MAX_HARNESS_LINE_BYTES): AsyncGenerator<string> {
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', { fatal: true });
  let chunks: Uint8Array[] = [];
  let bytes = 0;
  let n = 0;
  const flush = (tail: Uint8Array): string => {
    let line: Uint8Array = tail;
    if (chunks.length > 0) {
      line = new Uint8Array(bytes);
      let at = 0;
      for (const part of [...chunks, tail]) {
        line.set(part, at);
        at += part.byteLength;
      }
    }
    chunks = [];
    bytes = 0;
    n++;
    if (line.byteLength > 0 && line[line.byteLength - 1] === 0x0d) {
      line = line.subarray(0, line.byteLength - 1);
    }
    try {
      return dec.decode(line);
    } catch {
      throw new ProtocolError(`input line ${n} is not valid UTF-8`);
    }
  };
  const over = (count: number): ProtocolError =>
    new ProtocolError(`input line ${n + 1} is over ${limit} bytes (${count} so far)`);
  for await (const piece of src) {
    const buf = typeof piece === 'string' ? enc.encode(piece) : piece;
    let at = 0;
    while (true) {
      const cut = buf.indexOf(0x0a, at);
      if (cut === -1) break;
      const seg = buf.subarray(at, cut);
      if (bytes + seg.byteLength > limit) throw over(bytes + seg.byteLength);
      bytes += seg.byteLength;
      yield flush(seg);
      at = cut + 1;
    }
    if (at < buf.byteLength) {
      const rest = new Uint8Array(buf.subarray(at));
      bytes += rest.byteLength;
      if (bytes > limit) throw over(bytes);
      chunks.push(rest);
    }
  }
  if (bytes > 0) yield flush(new Uint8Array(0));
}

/** Where replies go: process.stdout by default. When write() returns false, wait for 'drain' if once() is there. */
export interface LineWriter {
  write(chunk: string): unknown;
  once?(event: 'drain', listener: () => void): unknown;
}

export interface BotIO {
  /** Harness lines; process.stdin by default. */
  input?: AsyncIterable<Uint8Array | string>;
  /** Replies; process.stdout by default. */
  output?: LineWriter;
}

export type OrdersResult = readonly OrderInput[] | void | null | undefined;

export interface Bot {
  /** Once, after hello and before the first batch. */
  onHello?(state: BotState): void | Promise<void>;
  /** Once per batch, after state has taken the batch in: the orders to send. Returning nothing means no orders. */
  onBatch(state: BotState, batch: Batch): OrdersResult | Promise<OrdersResult>;
  /** Once, after the final account (positions already flattened) has taken effect. No reply is sent. */
  onDone?(state: BotState, done: Done): void | Promise<void>;
}

export interface RunResult {
  state: BotState;
  done: Done;
  /** How many batches were answered. */
  batches: number;
}

/**
 * Speak agent-fun/replay/v2 over stdin/stdout until done, then stop reading and resolve (the
 * process exits once stdout drains, even when the harness leaves stdin open). Rejects with
 * ProtocolError, OrderError, or whatever a callback raised; left unhandled, that ends the
 * process with exit code 1.
 */
export async function runBot(handlers: Bot, wires: BotIO = {}): Promise<RunResult> {
  const src = wires.input ?? process.stdin;
  const sink = wires.output ?? process.stdout;
  const enc = new TextEncoder();
  let s: BotState | null = null;
  let answered = 0;
  let n = 0;
  for await (const line of readLines(src)) {
    n++;
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new ProtocolError(`input line ${n} is not JSON`);
    }
    const kind = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { type?: unknown }).type
      : undefined;
    switch (kind) {
      case 'hello': {
        const hi = parsed as Hello;
        if (s !== null) throw new ProtocolError(`input line ${n}: a second hello`);
        if (hi.protocol !== PROTOCOL) {
          throw new ProtocolError(`the harness speaks ${describe(hi.protocol)}; this shim speaks ${PROTOCOL}`);
        }
        s = new BotState(hi);
        await handlers.onHello?.(s);
        break;
      }
      case 'batch': {
        const b = parsed as Batch;
        if (s === null) throw new ProtocolError(`input line ${n}: a batch before hello`);
        checkBatch(b, n);
        s.applyBatch(b);
        const out = s.toOrders(await handlers.onBatch(s, b));
        const resp: Reply = { type: 'reply', seq: b.seq, orders: out };
        const text = JSON.stringify(resp);
        const size = enc.encode(text).byteLength;
        if (size > MAX_BOT_LINE_BYTES) {
          throw new OrderError(`batch ${b.seq}: the reply is ${size} bytes (max ${MAX_BOT_LINE_BYTES}); send fewer orders (caps.max_orders_per_batch is ${s.hello.caps.max_orders_per_batch})`);
        }
        s.recordOrders(out);
        await writeLine(sink, `${text}\n`);
        answered++;
        break;
      }
      case 'done': {
        const fin = parsed as Done;
        if (s === null) throw new ProtocolError(`input line ${n}: done before hello`);
        s.applyDone(fin);
        await handlers.onDone?.(s, fin);
        return { state: s, done: fin, batches: answered };
      }
      default:
        throw new ProtocolError(`input line ${n}: unknown message type ${describe(kind)}`);
    }
  }
  throw new ProtocolError(s === null ? 'input ended before hello' : `input ended before done (after ${answered} batches)`);
}

function checkBatch(b: Batch, n: number): void {
  const acc = b.account;
  const shape =
    Number.isSafeInteger(b.seq) &&
    Number.isSafeInteger(b.slot) &&
    Array.isArray(b.events) &&
    Array.isArray(b.marks) &&
    Array.isArray(b.fills) &&
    typeof acc === 'object' &&
    acc !== null &&
    Array.isArray(acc.positions);
  if (!shape) throw new ProtocolError(`input line ${n}: malformed batch`);
}

function writeLine(sink: LineWriter, line: string): Promise<void> | void {
  const flushed = sink.write(line);
  if (flushed !== false) return;
  if (typeof sink.once !== 'function') return;
  const wait = sink.once.bind(sink);
  return new Promise<void>((resolve) => {
    wait('drain', resolve);
  });
}
