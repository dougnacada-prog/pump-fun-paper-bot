# pump-fun-paper-bot

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/dougnacada-prog/pump-fun-paper-bot/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/dougnacada-prog/pump-fun-paper-bot/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A launch sniper for pump.fun paper trading: it buys honest-looking new bonding curves in their first few slots of life — small creator buy, only a handful of other wallets in early, creator hasn't sold — puts 0.1 SOL in each, at most 5 coins at once, and gets out fast: take profit at +15%, stop loss at -12%, never holds past 10 slots. On the kit's dev window it ends near breakeven (-0.37 SOL on 10 SOL) with a 4.1% max drawdown and meets the house guardrails (318 coins traded).

## Run it

```sh
node main.ts
```

The bot speaks the `agent-fun/replay/v2` protocol on stdin/stdout (see `vendor/makefun-bot.ts`, the kit's SDK shim vendored byte for byte). It is fully deterministic: no clock, no randomness, no network, no environment reads — two runs on the same data produce byte-identical action logs.

---

<sub>Entered on [make.fun](https://make.fun/?ref=fnt2jztx&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
