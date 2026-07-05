# Artha — Strategy & Flow (plain English)

*Last updated: 2026-07-05*

Artha is a **paper-trading analyst** that runs every morning, finds the strongest
stocks in the Indian market, tells you what to buy and where to exit, and keeps
score of how well its picks do — so we can prove (or disprove) the strategy with
real numbers before risking real money. It **signals; you decide.** It never
places a real trade.

---

## 1. The one belief everything rests on

**Over intermediate horizons (~3–12 months), momentum has historically beaten
mean-reversion in Indian equities.** A stock that's been leading tends to keep
leading over the next several months, so for our 2-3-month holds the edge is in
**buying strength and riding it**, not buying the dip of a falling stock. This is
*horizon-specific* — intraday, weekly, and post-earnings *reversals* genuinely
exist; momentum is strongest over *months*, which is the horizon we trade.

We didn't assume this — we **tested** it (Section 6). Every "buy the dip" idea we
tried over our horizon lost money after costs. Only **relative-strength momentum**
survived. This
is also the belief behind well-known systems (Weinstein's Stage Analysis,
O'Neil's CANSLIM) and behind the commercial screener WealthLab, whose picks our
own picks agree with 4 times out of 5.

---

## 2. What we look for in a stock

Two things are **mandatory** — a stock is rejected outright if it fails either:

1. **Stage 2 (the trend gate).** Weinstein's four stages — Stage 1 basing, **Stage
   2 advancing (price above a *rising* 200-day average) ← we only buy this**, Stage
   3 topping, Stage 4 declining. Must be Stage 2 *right now*. This stops us buying a
   "good company" that's actually in a downtrend (RELIANCE was Stage 4).
2. **Liquidity (tradeability).** At least **₹5 crore/day** traded, so you can
   actually get in and out. Throws away tiny illiquid names that only *look* strong.

Everything else is a **weighted score, not a hard gate** — because (per our own
strategy review) no single soft signal should be able to veto a genuine leader.
The survivors are ranked on four factors, and we take the **top 15 (max 3 per
sector)**:

| Factor | Weight | What it captures |
|---|---|---|
| **Relative strength** (6-mo vs Nifty) | 40% | leadership — how far ahead of the market |
| **Delivery spike** (vs its own 20-day norm) | 20% | conviction — real accumulation rising *now* |
| **Relative volume** (vs its own 20-day norm) | 20% | interest — volume expanding on the move |
| **Sector strength** (momentum clustering) | 20% | is its sector leading? (buy the strong stock in the strong sector) |

Each factor is **percentile-ranked within the day's candidates**, so it's
normalized and scale-free. A **25% delivery floor** still applies as a hard cut to
kill pure intraday froth, and the **sector cap (max 3/sector)** stops the book from
over-concentrating.

**Delivery %** = how much of a day's volume was real buying-to-hold vs intraday
churn; we score the *spike* (today vs the stock's own 20-day norm), so a leader at
30% delivery whose usual level is ~21% (a 1.4× spike) scores well — the buying is
*rising*, which a flat "≥45%" cut would have missed.

*Why a score, not four equal gates?* A name shouldn't automatically win on RS alone,
and shouldn't be thrown away for narrowly missing on delivery. The score balances
all four. (Example: ACUTAAS had the *highest* RS but ranked 3rd because its volume
and delivery were soft; a name strong on **all four** won.)

---

## 3. Where the candidates come from (breaking the "bubble")

We don't just look at a fixed watchlist — that would only ever surface stocks we
already know. Each morning the candidate pool is:

- **News + pre-market brief** — stocks in play from overnight news.
- **NSE corporate announcements** — *every* official company filing (order wins,
  results, buybacks…). This lets an unknown small-cap with a real catalyst enter
  the funnel — we "mine diamonds" from the whole market, not a pre-set list.
- **The RS/Stage-2 screen** — we scan the Nifty-500 for the strongest Stage-2
  leaders and add the top ones.

All of these then face the same four gates. So *anything* can be surfaced, but
*only* real strength survives.

---

## 4. The daily flow (what happens at 07:35)

```
07:30  Pre-market brief (overnight news → direction)
07:35  ARTHA MORNING PIPELINE
        1. Gather candidates  (news + announcements + RS/Stage-2 screen)
        2. Vet each one       (Stage 2 → RS → liquidity → delivery spike)
        3. Split by horizon   (momentum leaders → 2-3 month; others → intraday)
        4. Work out levels    (buy price, ATR stop, 2:1 target)
        5. Store + SIGNAL YOU  (Telegram: buy → target / stop · delivery spike)
09:15  Market opens
09:20  Paper bucket BUYS the vetted picks (₹10,000 each) and manages exits
```

You get a Telegram message like:

> 📈 **Artha — Today's picks**
> **2-3 month (ride strength):**
> • **DATAPATTNS** — buy ~₹4507 → tgt ₹5206 / stop ₹4158 · 30% deliv (1.4×)
> *Exit: hold while Stage 2; exit on target, stop, or loss of Stage 2.*

---

## 5. How it buys and exits

- **Position size:** every pick gets an **equal ₹10,000** (paper). Equal weight
  means every pick is directly comparable — that's what lets us *score* the
  algorithm fairly.
- **The stop is where the trade is *wrong*, not a fixed %.** It's set to **2× the
  stock's own volatility (ATR)**, clamped to a 4–10% range — tight on calm names,
  wider on jumpy ones. So the loss you risk is *commensurate* with the stock.
- **The target is 2× the risk (2:1).** If the stop is 6% away, the target is 12%.
  Reward is always double the risk.
- **The real exit is the trend breaking:** we sell on the target, the stop, *or*
  the moment the stock **drops out of Stage 2** — whichever comes first.
- **For real trades:** the buy/target/stop we send are the exact numbers to set a
  **Zerodha OCO GTT** (one order holding both target and stop; whichever hits
  first fires, the other cancels — no screen-watching needed). Artha gives the
  levels; you place the order.

---

## 6. What the backtest shows — and its limits

We tested strategies against **Timothy Masters' four checks** (from *Testing and
Tuning Market Trading Systems*), which are designed to catch strategies that only
*look* good:

1. **Sensitivity / plateau** — do small changes to the settings keep working, or
   was it a lucky single setting? (Curve-fitting check.)
2. **Permutation** — shuffle the price history hundreds of times; if the strategy
   does about as well on the shuffled (meaningless) data, it was just luck. We
   want a low "p-value" (< 0.05).
3. **Partition / skill** — separate the return that came from the market simply
   drifting up from the return that came from the strategy's *timing*.
4. **Benchmark** — does it beat just buying and holding?

**Results (net of realistic costs — ~0.36% round-trip + 20% short-term tax):**

| Strategy | Verdict |
|---|---|
| Mean-reversion / RSI "buy the dip" | ❌ **Lost** money — permutation p ≈ 0.6–0.99 (pure luck) |
| Turnaround-Tuesday | ❌ Failed net of cost |
| Breakout-entry timing | ❌ Failed net of cost |
| **RS_ROTATION** (relative-strength momentum) | ✅ **Passed all four** |

**RS_ROTATION — the one that worked:**
- **~21% CAGR**, **Sharpe ~1.12** (good risk-adjusted return)
- **Permutation p = 0.02** — only a 2% chance this was luck
- **Both halves of history profitable** (+23% and +33%) — not one lucky period
- Beats buy-and-hold, and its edge comes from *timing/selection*, not market drift
- It works because it's **low-turnover** (holds the top ~5 leaders, min ~90 days) —
  so trading costs don't eat the gains, which is what killed the busier strategies.

**Independent cross-check:** the commercial screener WealthLab (RS + Stage-2)
independently rated **4 of our 5** momentum picks as Stage-2 uptrends — two very
different systems agreeing is strong evidence we're finding real strength.

**What this does *not* yet prove.** We ran the permutation test, but not the full
battery a quant desk would want before real money: **walk-forward** (roll train→
test through time), **regime-specific** performance (COVID crash, 2022 correction,
sideways years), **bootstrap confidence intervals** on the CAGR, and **Monte
Carlo trade-sequencing** (probability of ruin / drawdown distribution). So the
honest claim is: *historical testing indicates relative-strength momentum showed
statistically significant outperformance under the tested assumptions.* Whether
that edge persists live is what the forward-test scorecard is measuring — and the
full daily system (news + announcements + spike + ₹10K accumulation) is an
**untested extension** of the validated momentum core, not itself yet validated.

**Expanded validation (2026-07-05, monthly RS rotation, top-5, ~80 names, 108
months).** We built the harness the review asked for:

*Regime performance (annualized):* profitable in **every** regime — Pre-COVID
+8%, COVID-2020 +79%, Bull-2021 +175%, **Correction-2022 +82%**, Recovery-23/24
+33%, Current-25/26 +19%. Momentum held up even in the 2022 correction.

*Bootstrap 95% CI on CAGR:* point ≈ **47%**, but the 95% interval is **wide:
[+18%, +83%]**. The honest takeaway is *not* "47% CAGR" — it's "positive with
high uncertainty."

*Monte-Carlo (same returns, shuffled order):* median max-drawdown **−36%**,
worst-5% **−52%**; probability of ending the period in a loss **≈ 0%**, of losing
half **≈ 0%**. So over a full cycle it reliably made money — **but the interim
drawdowns are brutal (−35% to −50%)**. A concentrated top-5 momentum book is a
high-return, high-drawdown ride; position count and regime-scaling would soften it.

*Caveats that keep me honest:* this run has **survivorship bias** (today's index
members), **excludes transaction costs**, and short regime windows make those
annualized figures noisy. So: *directionally strong and robust across regimes,
with large drawdowns and wide confidence bands* — a fair, unglamorous summary.

---

## 7. How we score it going forward

Because every paper pick is an equal ₹10,000, we can measure the algorithm
honestly. The **scorecard** (on the Today's Picks page) tracks, as trades close:

- **Win rate** — what % of picks made money
- **Average return** per pick
- **Realized P&L** (closed) and **unrealized** (open)

Over the coming weeks this fills in and gives a real, no-excuses answer on whether
the strategy delivers. New strong names get added each day (deduped — a name
already held isn't re-bought), so the sample grows and the score gets more
trustworthy.

There's also an **Exit Review** page that runs *your existing holdings* through
the same Stage/RS lens and flags **EXIT** (Stage 4), **TRIM** (Stage 3 or lagging
the Nifty), **REVIEW** (Stage 1, idle) or **HOLD** (Stage 2).

And the **Watchlist** is now a *dynamic RS/Stage-2 leader list* (not a static set of
blue-chips). "Rebuild from RS leaders" repopulates it from the current screen and
stamps each name with its **entry price, date, and sector**, so the page tracks
**growth/loss since entry** live — a running report card on the leaders themselves.

---

## 8. What Artha deliberately does *not* do

- **No real trades.** It signals; you place orders yourself.
- **No P/E or "cheapness" filters.** The best momentum stocks are usually
  "expensive" — a value filter would fight the edge. Price and delivery *are* our
  quality signals.
- **No shorting for multi-day holds** (cash equities can't be held short overnight
  in India) — long-only for anything beyond intraday.
- **No futures** — no thoroughly-validated futures strategy yet.

---

## 9. Changes from the strategy review (2026-07-05) — and what's deferred

An external review rated the framework 8.5/10. What we changed in response:

- **Tempered the claims.** "Stocks trend, don't revert" → scoped to the 3–12-month
  horizon we trade (reversals exist intraday/weekly). "We know it works" → "what the
  backtest shows *and its limits*."
- **Hard gates → a weighted score** (Section 2). Only Stage 2 + liquidity are
  mandatory now; RS / delivery-spike / relative-volume / sector-strength are a
  ranked score. No single soft signal can veto a leader.
- **Added relative-volume and sector-strength** as score inputs; **demoted the
  delivery filter** from a veto to a 20% score input; **added a sector cap** (max
  3/sector) for concentration.
- **Expanded validation** (Section 6): regime performance, bootstrap CI, and Monte
  Carlo — with the honest result (robust across regimes, but wide CI and large
  drawdowns).
- **Dynamic RS watchlist** replacing the static blue-chips.

**Deferred — and why (so it's on the record):**

- **Objective news classification** (positive-catalyst-only rules). *Lower urgency:*
  the price-based Stage-2/RS gates already filter out bad-news names downstream. On
  the list.
- **Exit-system rework** (a single coherent trailing-stop / Stage-2 exit, with the
  ATR stop as a *wide disaster stop* only). The review correctly noted the current
  ATR-stop + Stage-exit + fixed target can conflict — but fixing it properly
  **needs the validation harness to tune**, so it comes *after* validation, not before.
- **Regime-scaled exposure + portfolio limits** (max positions, sector weight caps).
  Correct for *going live*, but they would undo the deliberate **"no-cap, ₹10K,
  accumulate max sample"** design of the current forward-test, whose whole point is
  to score stock *selection*. Deferred to the live phase (a sector cap is already in
  for scoring integrity).
- **Dynamic liquidity** (top-% by traded value vs the fixed ₹5cr floor) — minor;
  the floor works for now.
- **Earnings-growth overlay** — *maybe*, and only as a quality *rank boost*. **Not
  P/E** — a value filter fights the momentum edge.
- **ADX filter** — declined: Stage 2 (price above a rising 200-DMA) already encodes
  "is it trending"; ADX is largely redundant.

---

## In one sentence

**Artha buys the market's strongest, real-money-backed uptrends, risks only what
each stock's own volatility justifies, aims for double that in reward, exits when
the trend breaks — and keeps an honest scorecard so the strategy has to prove
itself.**
