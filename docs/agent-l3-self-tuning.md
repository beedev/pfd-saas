# Analyst Agent — L3 Self-Tuning Loop (design)

Status: **in build** (Phases 0–4 approved 2026-06-30). Branch `feat/analyst-agent`.

## Why

The intraday ORB sleeve (`run-intraday.ts`) is an L2 system: it perceives (LLM
news→bias brief) and executes a full trade lifecycle unattended, but every knob
(`targetR`, `riskPctPerTrade`, `LAST_ENTRY`, …) is a frozen constant. The
"is this working / what should change" intelligence lives in a human (chat
session), not in the code. L3 moves that feedback loop **into** the system: it
measures its own net-of-cost edge, proposes parameter changes, evaluates them,
and — behind a gate — applies them to the live sleeve.

Diagnostic that motivated this (sleeve 5, personal, 2026-06-29..30, 6 closed
round-trips): net **+₹425 but carried entirely by one target-hit winner**
(ICICIBANK +516); the other five were 15:15 forced square-offs netting −₹91.
Costs inverted gross winners (RELIANCE gross +₹51 → net −₹57) under the ~₹90
round-trip + 30% intraday-slab tax stack. Exits are **time-driven, not
signal-driven** (5/6 square-offs, 0 stop hits, 1 target hit). The fix space is
exactly a parameter-tuning problem — hence L3.

## The one invariant

> The loop may mutate **only `agentSleeves.paramsJson`**. It never changes
> capital, allocation, the trading universe, or the strategy. Capital/strategy
> autonomy is **L4** and is explicitly out of scope here.

Blast radius is bounded to "the agent ran the same strategy with different
knobs." This is what makes self-tuning safe to switch on while still on paper.

## Architecture: champion (live) + challenger (replay), not shadow sleeves

ORB is deterministic, so a candidate parameter set can be evaluated by
**replaying the champion's own session bars** through the same decision code —
no second live sleeve.

| Rejected: shadow live sleeves | Chosen: deterministic replay |
|---|---|
| New `AgentSleeveKey`s (fixed union) | No schema/key contortion |
| 2× Yahoo load every tick | Zero live footprint |
| Shadow trades pollute equity snapshots | Champion stays the single source of truth |
| Capital fictions to reconcile | Pure function over archived bars |

This mirrors the existing pattern in `engine/risk.ts` ("same code in live +
backtest"). **Champion** = the real forward-test sleeve (untouched).
**Challenger** = a backtest over the champion's archived bars. The only write to
live state is a gated `paramsJson` update.

The forward-test **grows its own replay corpus**: each live session archives the
bars it used, so the tuner's evaluation window lengthens over time.

## Enabling refactor (Phase 0, foundation)

`run-intraday.ts` fuses decision logic with DB writes. Extract a **pure
per-tick planner**:

```
planIntradayTick(snapshot, params, brief) → Intent[]      // pure, no I/O
```

- `snapshot` = per-symbol bars + current position + running caps (cash,
  grossDeployed, openCount) + sleeve allocation + now/runDate.
- `Intent` = OPEN/CLOSE with fully-computed sizing + evidence (the same
  `AgentDecisionEvidence` shape persisted today).

`run-intraday.ts` becomes: load state → `planIntradayTick()` → persist intents.
`tuning/replay.ts` drives the **same** planner tick-by-tick over archived bars
with a simulated position/cash book. Parity (live trades == replay@champion
params for the same day) is the Phase 0 acceptance test.

## Modules

| Module | SRP |
|---|---|
| `agent/engine/orb-step.ts` | pure ORB per-tick planner (extracted) |
| `agent/tuning/metrics.ts` | net-of-cost edge score from trades+decisions |
| `agent/tuning/replay.ts` | drive the planner over archived bars → metrics |
| `agent/tuning/candidates.ts` | deterministic bounded grid/hill-climb proposer |
| `agent/tuning/explain.ts` | LLM writes the human "why" for a chosen candidate |
| `agent/tuning/promote.ts` | gate + guardrails + param history + rollback |
| `agent/tuning/bars-archive.ts` | persist session bars → replay corpus |
| `cron/agent-self-tune.ts` | nightly orchestration (~16:00 IST) |

Tuner brain = **search decides, LLM explains**: `candidates.ts` (deterministic)
picks the winner on the numeric metric; `explain.ts` only narrates it for the
digest. No nondeterminism in the decision path.

## Schema (migration 0057, documented psql + manual journal pattern)

- `agent_param_experiments` — one row per challenger evaluation: sleeveId,
  window, champion params+metrics, challenger params+metrics, decision
  (HELD/PROMOTED/REJECTED), reason, llm rationale.
- `agent_param_history` — every promotion: sleeveId, from/to params, trigger
  metrics, ts, rollback marker. Accountability ledger + rollback source.
- session-bars archive — per sleeve/date intraday bars for replay (own table or
  reuse an `agentBacktests`-style jsonb).
- new cron job type `agent_self_tune`, IST-anchored ~16:00 (post square-off),
  same `ADVANCE_MS` + zone trick as `agent_premarket_brief`.

## Phases (baton-passing; each ships + verifies)

- **P0 Foundation** — extract `planIntradayTick`; prove byte-identical live
  behavior (replay today == logged decisions).
- **P1 Metrics** — `metrics.ts` reproduces the hand analysis (sleeve 5 → +₹425,
  exit-mix, cost-drag).
- **P2 Replay + archive** — replay@champion == live within rounding.
- **P3 Candidates + experiments (L3a, propose-only)** — nightly job logs
  experiments + surfaces "challenger would have netted X vs live Y" in the
  digest. **Monitor window.**
- **P4 Promotion gate (L3b, auto-tune)** — auto-write `paramsJson` behind
  guardrails; param history + rollback live.

## Auto-promotion guardrails (P4)

- Sample floor: ≥N closed challenger trades AND ≥M sessions.
- Margin beyond noise: challenger net-edge > champion by threshold, bootstrap-checked.
- Bounded params: `targetR ∈ [1.0,3.0]`, `riskPctPerTrade ∈ [0.25,1.5]`,
  `LAST_ENTRY ∈ [12:00,14:30]`, etc. Tuner cannot leave the box.
- One param step per promotion + cool-down K sessions.
- Auto-rollback if post-promotion live edge degrades vs pre-promotion baseline.
- Kill switch: portfolio flag pins params + disables tuning instantly.

## Out of scope (L4, later)

Capital allocation across sleeves, regime-driven strategy selection, strategy
synthesis, real-money execution. Build + monitor L3 first.
