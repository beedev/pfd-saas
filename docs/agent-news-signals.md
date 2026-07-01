# Analyst Agent — News-Signal Learning Loop (design)

Status: **Phase 1 built + verified** (2026-07-01). Branch `feat/analyst-agent`.

## Why

The EOD "why did we miss these movers" question isn't about chasing yesterday's
stocks — it's about learning **reusable signals**: news patterns that *predict*
big moves. Those live as a self-curating dictionary of weighted phrases; once a
phrase proves it predicts (Bayesian hit-rate past a threshold over enough days),
its matching news **auto-triggers a trade**. The loop closes because the **LLM
is the generic detector** — a signal is data (phrase + weight), not code.

## The loop
```
every 30-min news tick:  ingest → LLM maps EACH equity headline to a dictionary
                         phrase (map-or-mint) → [Phase 3] trusted phrase → trade
EOD (~16:30 IST):        Nifty 500 movers vs non-movers → per tag HIT/MISS/NEUTRAL
                         → update each phrase's Bayesian weight (decayed)
                         → mint/enrich from movers' news + flag coverage gaps
next day:                phrases past threshold act; decayed ones demote
```

## Key design resolutions (with Bharath)
- **Signal identity** — solved by an LLM-curated growing dictionary: each pass the
  LLM sees the current dictionary and decides map-to-existing (strongly preferred)
  or mint-new. Zero-phrase cold start; converges.
- **Credit assignment** — weight = **precision**, not frequency: tag the WHOLE
  universe's news (movers AND non-movers) so `weight = movers-with-phrase /
  all-with-phrase`. A generic phrase ("results announced") never crosses the bar.
- **Trust bar** — Bayesian hit-rate ≥ **0.6** AND ≥ **5 distinct observed days**
  (config in `dictionary.ts`); hysteresis demote < 0.45. Decay forgets stale regimes.
- **Trigger** — intraday, on the news tick (≤30-min latency = the ingest cadence).
- **Exit** (Phase 3) — ATR/fixed-% stop+target, same-day square-off (never overnight).
- **Global tables** — signals are market knowledge (like agent_news / agent_daily_brief);
  no user_id. The trading bucket (Phase 3) is per-user.

## Schema (migration 0058)
- `agent_signal_phrases` — the dictionary: phrase, direction, description, status
  (MONITORING/TRUSTED/DEMOTED), alpha/beta (Beta), observed_days, appear_count,
  examples. Weight = α/(α+β).
- `agent_news_signal_tags` — credit ledger: (news, symbol) → phrase, outcome
  (PENDING→HIT/MISS/NEUTRAL at EOD), move_pct.
- `agent_eod_reviews` — daily postmortem (movers, phrases minted/updated, gaps).
- `agent_news.signal_tagged` — processed marker (no base-rate double-count).

## Modules
| Module | Job | Phase |
|---|---|---|
| `signal/dictionary.ts` | phrase CRUD + Bayesian weight/trust/decay | 1 ✅ |
| `signal/tag-news.ts` | LLM map-or-mint tagging + ingest-tick orchestrator | 1 ✅ |
| `universe/nifty500.ts` | baked NSE list (movers universe) | 2 |
| `signal/eod-review.ts` | movers vs non-movers → outcomes → weight updates, mint, gaps | 2 |
| `signal/trigger.ts` | trusted-phrase match on tick → trade | 3 |
| `engine/run-news-signal.ts` | news-signal bucket (ATR exit, same-day square-off) | 3 |

## Phases
1. **Dictionary + tagging** ✅ — LLM tags fresh news on the 30-min tick; base-rate
   corpus builds. No trading. Verified: minted "large order win"/"earnings
   beat"/"regulatory penalty", omitted generic news, Bayesian math correct.
2. **EOD credit assignment** — Nifty 500 movers, set tag outcomes, update weights,
   mint/enrich from movers, coverage-gap report. New `agent_eod_review` cron (16:30 IST).
3. **News-signal bucket + auto-trigger** — trusted phrase → trade, behind opt-in gates.
4. **UI + tuning/allocator hooks** — surface dictionary + reviews; tie into multi-bucket.

## Out of scope (later)
The broader multi-strategy buckets (VWAP, gap-and-go, VIX regime overlay) + the
capital allocator across buckets — this news-signal bucket is the first of them.
