// pump-fun-paper-bot: a launch sniper for the agent-fun/replay/v2 pump.fun
// harness (make.fun "Pump.fun Paper Sprint: Any Bot Can Win").
//
// Idea, in plain words: buy new coins in their first few slots of life, but
// only launches that look honest — the creator did not buy a huge chunk
// themselves, only a handful of other wallets piled in at the start (a launch
// bundled by many wallets is usually the creator's cluster waiting to dump),
// the creator has not sold, and nobody has dumped a big sell yet. Put 0.1 SOL
// in each coin, at most 5 coins at once. Then get out fast: take profit at
// +15% over cost, cut the loss at -12%, and never hold past 10 slots — about
// half a minute of chain time. If the creator sells while we hold, leave at
// once. (The trailing stop is left off: on the dev window it cut winners
// early without saving losers.)
//
// Why this shape: on the kit's dev window a momentum bot that buys after a
// run-up loses ~95% (it buys the top and rides the dump), while this
// buy-early / sell-fast shape ends near breakeven with a ~5% max drawdown and
// meets the house guardrails (20+ coins, drawdown under 50%). The final
// window is fresh data, so nothing is guaranteed — but a shape that survives
// the dev window with its capital intact is the right one to enter.
//
// Deterministic by construction: no clock, no randomness, no network, no
// environment reads. All money math is integer lamports (bigint); iteration is
// only over insertion-ordered maps fed by the batch stream, so two runs on the
// same data produce byte-identical replies.

import { LAMPORTS_PER_SOL, runBot, type BotState, type Batch, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

const BPS = 10_000n;
// Curve fee share taken on a trade (protocol 95 bps + creator 30 bps fallback).
const FEE_BPS = 125n;

const P = {
  maxAgeSlots: 3, // oldest age (slots since CreateEvent) a first buy may be decided
  stakeLamports: 100_000_000n, // 0.1 SOL per coin
  minBuyLamports: 5_000_000n, // 0.005 SOL: smallest buy worth the tx fee
  minRealSolLamports: 300_000_000n, // curve real SOL at entry, lower bound
  maxRealSolLamports: 30_000_000_000n, // curve real SOL at entry, upper bound
  maxDevBuyLamports: 2_000_000_000n, // creator's own buys in the create slot, at most
  minBuyers: 0, // distinct non-creator buyers seen before entry, at least
  maxBuyers: 3, // distinct non-creator buyers, at most (rug filter)
  maxSellRatioBps: 10_000n, // lamports sold by others / lamports bought, at most (100%)
  maxBigSellBps: 5_000n, // largest single non-creator sell, as bps of real SOL, at most (50%)
  minRunupBps: 8_000n, // price now over create price, at least (0.8x)
  maxRunupBps: 20_000n, // price now over create price, at most (2x)
  buySlipBps: 10_000, // slippage allowed on buys
  tpBps: 1_500n, // take profit: exit at +15% over basis
  slBps: 1_200n, // stop loss: exit at -12% under basis
  trailArmBps: 100000n, // trailing stop effectively off (never arms)
  trailBps: 800n, // trailing stop: exit on an 8% fall from the best value
  maxHoldSlots: 10, // never hold past this many slots
  skipDevSold: true, // skip a coin whose creator sold before entry
  exitOnDevSell: true, // exit at once if the creator sells while held
};

/** What selling `tokens` against (vq, vt) pays after the curve fee. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const gross = (tokens * vq) / (vt + tokens);
  return gross - (gross * FEE_BPS + BPS - 1n) / BPS;
}

interface Coin {
  creator: Pubkey;
  createSlot: number;
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  trades: number;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  bigSellBps: bigint;
  devSold: boolean;
  lastTradeSlot: number;
  boughtOnce: boolean;
  done: boolean;
}

interface Held {
  openedSlot: number;
  txPaid: bigint;
  bestValue: bigint;
}

const coins = new Map<Pubkey, Coin>();
const held = new Map<Pubkey, Held>();
const selling = new Set<Pubkey>();

function hasPendingBuy(state: BotState, mint: Pubkey): boolean {
  for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'buy') return true;
  return false;
}

function hasPendingSell(state: BotState, mint: Pubkey): boolean {
  for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'sell') return true;
  return false;
}

await runBot({
  onBatch(state: BotState, batch: Batch): OrderInput[] {
    // Fold the batch's events into the per-coin tape.
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          creator: e.creator,
          createSlot: e.slot,
          vq0: BigInt(e.virtual_quote_reserves),
          vt0: BigInt(e.virtual_token_reserves),
          devBuy: 0n,
          trades: 0,
          buyers: new Set(),
          bought: 0n,
          soldByOthers: 0n,
          bigSellBps: 0n,
          devSold: false,
          lastTradeSlot: e.slot,
          boughtOnce: false,
          done: false,
        });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        const sol = BigInt(e.sol_amount);
        c.trades += 1;
        c.lastTradeSlot = e.slot;
        const isDev = e.user === c.creator;
        if (e.is_buy) {
          c.bought += sol;
          if (isDev && e.slot === c.createSlot) c.devBuy += sol;
          else if (!isDev) c.buyers.add(e.user);
        } else if (isDev) {
          c.devSold = true;
        } else {
          c.soldByOthers += sol;
          const reserveBefore = BigInt(e.real_quote_reserves) + sol;
          if (reserveBefore > 0n) {
            const bps = (sol * BPS) / reserveBefore;
            if (bps > c.bigSellBps) c.bigSellBps = bps;
          }
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) c.done = true;
      }
    }

    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = state.txFeeLamports();
    const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
    for (const m of batch.marks) {
      marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });
    }

    // Fold fills in: track tx fees paid per held coin, open/close held records.
    for (const f of batch.fills) {
      if (f.client_id.startsWith('_')) {
        held.delete(f.mint);
        selling.delete(f.mint);
        continue;
      }
      const h = held.get(f.mint);
      if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
      if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
        held.set(f.mint, { openedSlot: f.slot, txPaid: BigInt(f.tx_fee_lamports), bestValue: 0n });
      }
    }
    for (const mint of [...selling]) if (!hasPendingSell(state, mint)) selling.delete(mint);
    for (const mint of [...held.keys()]) {
      if (!state.positions.has(mint) && !selling.has(mint) && !hasPendingBuy(state, mint)) held.delete(mint);
    }

    // Exits first: take profit, stop loss, trailing stop, time limit, dev sell.
    for (const [mint, pos] of state.positions) {
      if (orders.length >= cap) break;
      if (selling.has(mint)) continue;
      const c = coins.get(mint);
      let h = held.get(mint);
      if (h === undefined) {
        h = { openedSlot: state.slot, txPaid: tx, bestValue: 0n };
        held.set(mint, h);
      }
      let mk = marks.get(mint);
      if (mk === undefined) {
        const cv = state.curves.get(mint);
        if (cv === undefined) continue;
        mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
      }
      const value = sellValue(BigInt(pos.token_amount), mk.vq, mk.vt) - tx;
      const basis = BigInt(pos.cost_lamports) + h.txPaid;
      if (value > h.bestValue) h.bestValue = value;
      let exit = false;
      if (basis > 0n) {
        if (value * BPS >= basis * (BPS + P.tpBps)) exit = true;
        if (value * BPS <= basis * (BPS - P.slBps)) exit = true;
        if (h.bestValue * BPS >= basis * (BPS + P.trailArmBps) && value * BPS <= h.bestValue * (BPS - P.trailBps)) exit = true;
      }
      if (state.slot - h.openedSlot >= P.maxHoldSlots) exit = true;
      if (c !== undefined && P.exitOnDevSell && c.devSold) exit = true;
      if (!exit) continue;
      orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      selling.add(mint);
      if (c !== undefined) c.done = true;
    }

    // Entries: one 0.1 SOL buy per honest-looking launch, in its first slots.
    let free = state.freeCashLamports() - tx * BigInt(orders.length);
    let open = state.committedPositionCount();
    for (const [mint, c] of coins) {
      if (orders.length >= cap) break;
      if (c.done || c.boughtOnce) continue;
      const age = state.slot - c.createSlot;
      if (age > P.maxAgeSlots) {
        c.done = true;
        continue;
      }
      if (open >= state.hello.caps.max_open_positions) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      if (P.skipDevSold && c.devSold) {
        c.done = true;
        continue;
      }
      // Rug filter: real SOL in range, creator did not load up, only a few
      // other wallets in early, no heavy selling yet, price not spiked away.
      const rq = curve.real_quote_reserves;
      if (rq < P.minRealSolLamports || rq > P.maxRealSolLamports) continue;
      if (c.devBuy > P.maxDevBuyLamports) continue;
      if (c.buyers.size < P.minBuyers || c.buyers.size > P.maxBuyers) continue;
      if (c.bought > 0n && c.soldByOthers * BPS > c.bought * P.maxSellRatioBps) continue;
      if (c.bigSellBps > P.maxBigSellBps) continue;
      const vq = curve.virtual_quote_reserves;
      const vt = curve.virtual_token_reserves;
      if (c.vt0 === 0n || c.vq0 === 0n || vt === 0n) continue;
      const runup = (vq * c.vt0 * BPS) / (vt * c.vq0);
      if (runup < P.minRunupBps || runup > P.maxRunupBps) continue;
      const maxBuy = state.maxBuyLamports(mint);
      const amount = P.stakeLamports < maxBuy ? P.stakeLamports : maxBuy;
      if (amount < P.minBuyLamports) continue;
      if (free < amount + tx) continue;
      orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: P.buySlipBps });
      free -= amount + tx;
      c.boughtOnce = true;
      open += 1;
    }
    return orders;
  },
});
