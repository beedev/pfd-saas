# The Analyst, in plain English

Notes written for review (2026-07-05). Nothing here is built yet — this is
analysis to decide what to build. All of it is on **paper / pretend money**.

---

## 1. How RS_ROTATION works (recap)

Give every stock a **scorecard**: how much it climbed over the past year
(skipping the last month, to ignore short-term wobble) **divided by how bumpy
the climb was** (so a steady climber beats a wild one). Rank all 150 stocks by
that score.

- **Buy** the top 3 — but only when they're genuinely rising **and** the whole
  market is healthy (Nifty above its 200-day average line).
- **Hold** at least ~3 months (the anti-fidget rule — trading rarely keeps fees
  tiny; this is *the* reason it works).
- **Sell** when a stock drops out of the top ~5 (a small cushion so we don't
  swap on every wiggle), or when the whole market turns down.

It never predicts the future. It just **owns what's already winning, patiently.**

---

## 2. Why the other strategies FAILED (plain English)

We tested five ideas. Four lost money net of costs. Here's why, simply:

**"Buy the dip" / Turnaround / mean-reversion** — *buy stocks that just fell,
hoping they bounce.* This is **catching a falling knife**. In India, a falling
stock usually keeps falling (bad news has momentum). Our maths test showed the
real data did *worse* than random shuffling — meaning the signal was actively
**backwards**. Buying weakness is the losing side here.

**Momentum/breakout *entry timing*** — *buy the moment a stock breaks to a new
high.* The idea is right (winners keep winning), but the **execution bleeds you
dry**: every buy/sell pays ~0.4% in fees + a 20% tax on profits. If you trade
often, those costs quietly eat the whole edge. It's a good idea traded too
frequently.

**The one-line lesson:** the enemy isn't picking stocks — it's **trading too
often**. Fees + tax multiply with every trade. The winner (RS) trades ~10
times a *year*; the losers traded dozens of times. **Patience is the edge.**

---

## 3. The backtest "quality gates" (why we trust a result)

A backtest that *looks* profitable proves nothing — anyone can find a rule that
worked on past data by luck. So we put every strategy through four checks
(from Timothy Masters' book). In plain terms:

1. **The plateau test (is it real or a fluke?)** — nudge the settings up and
   down (e.g. hold the top 3 vs 4 vs 5). A real edge stays good across a *range*
   of settings (a smooth plateau). A fluke works at exactly one magic number and
   collapses either side (a lone spike) — that means it was **fitted to the
   past**, not a real pattern.

2. **The luck test (permutation)** — shuffle the price history thousands of
   times into fake random data and re-run the strategy. If the *real* result
   beats almost all the fakes, it's very unlikely to be luck. RS beat 50 of 50
   shuffles. Turnaround *lost* to 49 of 50 — proof it had a real (but *negative*)
   pattern.

3. **The skill test (partition)** — separate "did the market just go up and
   carry you" from "did your *timing* add value." You want the return to come
   from **skill**, not from riding a rising tide.

4. **The benchmark test** — compare to simply **buying and holding the whole
   market.** A strategy has to beat that (on return *or* on a smoother ride),
   otherwise why bother? RS returned ~21%/yr vs the market's ~12%, with a
   calmer ride.

**Only RS_ROTATION passed all four.** That's why it's the one we run.

---

## 4. Liquidity & market cap (your question)

**Liquidity = can you actually buy/sell without moving the price.** We measure
it as **"traded value per day"** = how many rupees of the stock change hands
daily. A stock trading ₹300 crore/day is an ocean — your order vanishes into it.
A stock trading ₹0.5 crore/day is a puddle — your order alone shoves the price,
and you get a *worse* price than the screen shows. **Backtests never see this
gap, so they lie about thin small-caps.**

- Today's top picks were all **deep** (₹37–436 cr/day) — because our universe is
  the top-150 Nifty names (all large/mid, all liquid). No problem *yet*.
- **But** if we widen to all 500 stocks (to catch small-cap momentum), thin names
  will appear — and that's when a **liquidity filter** (drop anything trading
  below, say, ₹5 cr/day) becomes essential.
- **Market cap** (company size) is a *size* label; **traded value** is the
  *tradeability* label — and tradeability is what actually matters. Market cap
  isn't in our data feed today; can be added.

**To build tomorrow:** a liquidity filter (drop thin names before ranking) so RS
stays safe on a wider, more interesting universe.

---

## 5. How to make RS more robust (experiment results)

We tested variations. Numbers are *relative* (a quick test engine; the live RS
has stronger risk controls, so real numbers are better — ~21% CAGR, 26% max
drop). What matters is which variation *improved* vs the baseline:

| Change | Verdict |
|---|---|
| **Hold 5 stocks instead of 3** | ✅ **Best single win** — higher return, smoother ride, smaller drops. Simple diversification. |
| Sector cap (max ~2 per sector) | ✅ **Smaller drawdowns** (less return) — stops piling into one theme (the Adani-blowup lesson). Good for a calmer ride. |
| Trend filter (only above own 200-DMA) | ➖ Marginal help. Optional. |
| 6-month momentum instead of 12 | ❌ Worse. Keep 12-month. |
| **Stack ALL filters at once** | ❌❌ **Backfired badly** (8% vs 18%) — over-filtering throws out the strongest names. **Lesson: one change at a time.** |

### Recommendations to build tomorrow (in priority order)
1. **Hold 5 instead of 3.** The clearest, safest improvement — better on every
   measure. Low risk.
2. **Add a sector cap (max 2 per sector).** Prevents a single-theme blowup (like
   Adani-Hindenburg). Costs a little return for a much calmer ride.
3. **Add a liquidity filter** (drop thin names) — *safety*, especially before
   widening the universe. Doesn't change today's picks.
4. **Keep 12-month momentum. Do NOT stack every filter** — the combo test proves
   over-engineering destroys the edge. Add improvements **one at a time**, and
   re-run the four quality gates after each.

### The meta-lesson
Every "smart-sounding" addition has to *earn its place* through the gates.
Half of them didn't. RS wins by being **simple + patient + diversified**, not
clever. Robustness comes from **holding a few more names and not over-trading**,
not from more rules.
