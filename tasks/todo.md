# L3 Self-Tuning Loop — WBS

Design: `docs/agent-l3-self-tuning.md`. Branch `feat/analyst-agent`. Paper only.
Invariant: the loop mutates ONLY `agentSleeves.paramsJson` — never capital,
universe, or strategy (that's L4, deferred).

Scope approved 2026-06-30: Phases 0–4 (full auto-tune). Tuner = deterministic
search decides + LLM explains. Persist plan + design doc (done).

## Phase 0 — Foundation refactor (pure ORB step)  ✅ DONE — checkpoint
- [x] Types `Intent` + `TickSnapshot` + `UniverseEntry` (folded into `orb-step.ts`, no separate file)
- [x] Extract `planIntradayTick(snapshot) → {intents, finalCash, quotes}` (`agent/engine/orb-step.ts`) — pure, no DB
- [x] Rewrite `run-intraday.ts` to: load state → planIntradayTick → persistOpen/persistClose (behavior unchanged)
- [x] Parity check: fixture reproduces real OBEROIRLTY logged decision (stop 174630/target 179430/qty 14) + cost/tax accounting (15/15)
- [x] `tsc --noEmit` clean (0 errors). Live `run-now` smoke deferred to user (prod sleeve).
- NOTE: full intraday round-trip cost confirmed = 0.125% (.025 STT + .04 slip + .06 charges) + 30% slab tax — the cost hurdle every ORB trade must clear.

## Phase 1 — Measurement  ✅ DONE (commit 81b2816)
- [x] `agent/tuning/metrics.ts` — computeEdge: net, winRate, avgR, costDrag%, payoff, sharpe, exitMix, n
- [x] `closedTradesFromExitEvidence()` adapter (reads champion edge from decision ledger)
- [x] Verified vs live sleeve 5: net +₹425.10, 4W/2L, target-hit 1/square-off 5, cost-drag 60.9%, avgR 0.145

## Phase 2 — Replay engine  ✅ DONE
- [x] `agent/tuning/replay.ts` — replayDay drives planIntradayTick over a session's bars → ClosedTrade[] → metrics
- [x] Verified: lifecycle correctness (realized 75252/18611 hand-checked) + param-sensitivity (targetR 1.5 vs 3.0)
- NOTE: bars-archive persistence moved to Phase 3 (lands with migration 0057). Replay is pure; tested on synthetic bars.

## Phase 3 — Candidates + experiments (L3a propose-only)  ✅ DONE
- [x] Migration 0057: agent_session_bars, agent_param_experiments, agent_param_history + sleeve tuning gates. Applied to DEV (psql + manual journal). Prod-apply steps prepared.
- [x] `agent/tuning/candidates.ts` — bounded one-step hill-climb (targetR/riskPct/maxConcurrent within hard box)
- [x] `agent/tuning/bars-archive.ts` — archiveSession (grow corpus) + loadWindow (replay input)
- [x] `agent/tuning/replay.ts` — replayWindow multi-session aggregator added
- [x] `agent/tuning/explain.ts` — gpt-4.1 "why" + deterministic fallback (decision never depends on LLM)
- [x] `cron/agent-self-tune.ts` — propose-only orchestrator (Phase 4 promote hook marked)
- [x] Wire `agent_self_tune` into cron tick (16:00 IST anchor, JobType, ADVANCE_MS, defaults list, handler)
- [x] Verified: tuner picks targetR 1.5→1.75 on trending history; DB-glue E2E logs PROPOSED experiment, NO param write, cleanup OK. tsc 0 errors.

### Prod-apply for migration 0057 (user runs when ready to redeploy)
- SQL: drizzle/0057_typical_silver_sable.sql · hash a7b21502e2b8ed69c92aa747bf85716d5770707256c6baf7f1d92cc3651372ea · journal when 1782812672433
- Apply inside vaspar-pfd: psql -f the SQL, then INSERT the journal row (same pattern as dev). NOTE: archiving + tuning only run once the new IMAGE is deployed (cron job is new code).

## Phase 4 — Promotion gate (L3b auto-tune)  ✅ DONE
- [x] `agent/tuning/promote.ts` — guardrails: lenient sample floor (≥5 sessions, ≥10 trades) + positive + avgR margin (0.05) + bootstrap significance (0.95) + 5-session cool-down
- [x] Auto-write paramsJson on pass; record `agent_param_history` (from/to + baseline)
- [x] Auto-rollback: revert when live edge since promotion < baseline after cool-down
- [x] Kill-switch = the two opt-in gates (tuningEnabled / tuningAutoPromote, both default false)
- [x] E2E verified on dev: PROMOTE (10 sessions→write+history), BLOCK (3 sessions→withheld, no write), ROLLBACK (live avgR 0.05<2.0→reverted). tsc 0 errors.

## Review
- L3 self-tuning loop complete (Phases 0–4) on `feat/analyst-agent`, local commits da2f2d7→(P4). Paper only.
- Dormant by default: nothing runs until vaspar-pfd is redeployed with the new image AND a sleeve's tuningEnabled (+ tuningAutoPromote for writes) are flipped on.
- Guardrails chosen lenient + bootstrap + auto-rollback + 5-session cool-down (user-set). The bootstrap protects the lenient floor from small-sample luck.
- L4 (capital allocation / regime strategy selection / real execution) deliberately deferred — monitor L3 first.
- Prod-apply for migration 0057: see Phase 3 section above.
