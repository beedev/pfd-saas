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

## Phase 1 — Measurement
- [ ] `agent/tuning/metrics.ts` — net, winRate, avgR, costDrag%, exitMix, sharpe, n
- [ ] Verify vs sleeve 5 live data: reproduces net +₹425, exit-mix, cost-drag table

## Phase 2 — Replay + bars archive
- [ ] `agent/tuning/bars-archive.ts` — persist per-session bars (schema 0057 part)
- [ ] `agent/tuning/replay.ts` — drive planIntradayTick over archived bars → metrics
- [ ] Fidelity: replay@champion == live metrics within rounding

## Phase 3 — Candidates + experiments (L3a propose-only)
- [ ] Migration 0057: `agent_param_experiments`, `agent_param_history`, bars archive, `agent_self_tune` job
- [ ] `agent/tuning/candidates.ts` — bounded grid/hill-climb around champion
- [ ] `agent/tuning/explain.ts` — LLM "why" for the chosen candidate
- [ ] `cron/agent-self-tune.ts` — nightly: archive → evaluate candidates → log experiments → digest line
- [ ] Wire `agent_self_tune` into cron tick (~16:00 IST anchor)
- [ ] Verify: experiments logged, digest shows "challenger X vs live Y", NO live param writes

## Phase 4 — Promotion gate (L3b auto-tune)
- [ ] `agent/tuning/promote.ts` — guardrails (sample floor, margin, bounds, one-step, cool-down)
- [ ] Auto-write paramsJson on pass; record `agent_param_history`
- [ ] Auto-rollback on post-promotion degradation
- [ ] Kill-switch portfolio flag
- [ ] Verify end-to-end on replayed history; confirm guardrails block premature promotion

## Review
- (added at completion)
