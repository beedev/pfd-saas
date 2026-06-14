# WBS — Telegram Assistant

Spec: `docs/PLAN-telegram-assistant.md`. Tasks are baton-passing: each has an
explicit **output** and a **verify** step so the next task can start cleanly.
Check items off as they land.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 0 — Plumbing (no LLM). Goal: a provably reliable slash-command bot.

- [ ] **0.1 Dedicated bot wiring**
  - Output: `@pfdsaasbot` token configured on the always-on instance; digest/alerts also send via it.
  - Verify: `getMe` returns `pfdsaasbot`; a test digest arrives in your chat.

- [x] **0.2 DB tables**
  - Output: migration adding `telegram_inbox`, `telegram_outbox`, `telegram_conversations`, `telegram_command_log`, `assistant_api_settings` (schema per spec §6).
  - Verify: migration applies on a fresh container; columns present.

- [x] **0.3 Poller loop (scheduler)**
  - Output: a loop that `getUpdates(offset)` → inserts each update into `telegram_inbox` → **acks offset only after insert**; runs only on the always-on instance.
  - Verify: send 3 messages while the worker is paused → 3 inbox rows, offset advanced, no dupes; restart mid-batch → no loss/dupe.

- [x] **0.4 Sender (outbox drainer)**
  - Output: loop that sends `telegram_outbox` pending rows (retry on failure), marks sent.
  - Verify: enqueue a row → message arrives; kill Telegram reachability → row stays pending → retried on recovery.

- [x] **0.5 Worker skeleton + authz + audit**
  - Input: inbox rows. Output: worker that picks pending rows in `update_id` order, rejects non-paired `chat_id` (reply "not authorized"), writes a `telegram_command_log` row, marks inbox done.
  - Verify: message from the paired chat is processed; a different chat_id is rejected + logged.

- [x] **0.6 Slash parser + confirm flow + dedupe**
  - Output: parse `/command args`; for a `write` capability, enqueue an inline ✅/✖ confirm and persist pending; on the confirm callback, invoke; `dataIntegrity=true` skips if `(message_id, capability)` already in the log.
  - Verify: `/paid` shows a confirm; ✅ executes once; replaying the same update does **not** double-execute.

- [x] **0.7 Two end-to-end commands**
  - Output: `/networth` (read) and `/paid <card>` (integrity write) fully working through the loop, invoking existing app logic AS the user.
  - Verify: `/networth` returns correct totals; `/paid HDFC` → confirm → marks the statement paid exactly once; both logged.

**Phase 0 exit:** a reliable slash bot you'd trust, with zero AI involved.

---

## Phase 1 — Registry + invoker + Settings curation

- [x] **1.1 Code registry** (`src/lib/assistant/registry.ts`)
  - Output: `Capability[]` for the v1 set (spec §4c) with param schemas + `invoke()` wrappers over existing routes/lib.
  - Verify: each `invoke` works when called directly with valid args, scoped to the user.

- [ ] **1.2 Drift test**
  - Output: a test asserting every capability `path` resolves to a real route and required params match (where zod exists).
  - Verify: test passes; deliberately breaking a path fails the test.

- [ ] **1.3 Wire all v1 slash commands from the registry**
  - Output: `/tax /due /today /meal /inspaid /chitpay` driven by the registry (not hard-coded).
  - Verify: each command runs end-to-end; integrity-true ones confirm + dedupe.

- [x] **1.4 Settings — "Assistant APIs" screen**
  - Output: `getEffectiveCapabilities(userId)` merge (`effective.ts`) the worker + LLM router now route through; `GET/PATCH /api/settings/assistant-apis`; `AssistantApisForm` card (Include-in-assistant + AI-eligible/Slash-only toggles) wired into Settings.
  - Verify: ✅ exclude `get_net_worth` → free-text `no-match` + `/networth` "Unknown command"; ✅ flip `mark_card_paid` integrity true→false → free-text routed via LLM to `awaiting-confirm` (was `blocked-integrity`), no double-pay. Also closed the failed-invoke audit-log gap (`runAndReply` logs error rows).

**Phase 1 exit:** the surface is registry-driven and user-curated; drift-guarded.

---

## Phase 2 — LLM agent (reads + non-integrity writes)

- [x] **2.1 LLM router**
  - Output: build OpenAI function-call tools from **included + dataIntegrity=false** capabilities; map a free-text message → `{capabilityId, args}` | clarify | none.
  - Verify: "what's my net worth" → `get_net_worth`; "log breakfast: idli" → `log_meal` with extracted args; gibberish → graceful "I didn't get that".

- [ ] **2.2 Slot-fill loop**
  - Output: deterministic required-param check → ask follow-up → persist pending → merge reply; `optionsFrom` disambiguation via a read.
  - Verify: a command missing a required field asks for it; the follow-up reply completes it; TTL expiry abandons cleanly.

- [ ] **2.3 Result formatting (summary/full)**
  - Output: pass invocation result to the LLM → Telegram-friendly reply; "full"/"details" → expanded.
  - Verify: read replies are concise by default and detailed on request; an echo line shows what was understood.

- [ ] **2.4 Ship read + non-integrity-write capabilities**
  - Output: tax/net-worth/due/today reads + log_meal/tick_habit/log_weight via LLM.
  - Verify: each works via free text; writes still confirm; nothing integrity-true is LLM-reachable.

**Phase 2 exit:** the conversational assistant is live for the safe surface.

---

## Phase 3 — Hardening & polish

- [ ] **3.1** Rate-limiting per chat; abuse/error backoff.
- [ ] **3.2** Richer error UX (API failure, validation error, OpenAI down → "try again / use the slash command").
- [ ] **3.3** Multi-turn disambiguation polish; cancel/redo affordances.
- [ ] **3.4** Expand the capability set (more reads/writes as trust grows).
- [ ] **3.5** Observability view over `telegram_command_log` (what was asked/done).
- [ ] **3.6** Help docs: add an "Assistant" page to the in-app Help Center.

---

## Tracked follow-ups (NOT part of this feature)

- [ ] **Settings IA redesign** — group the ~12 Settings cards into sections/tabs; house the Assistant-APIs screen there.
- [ ] **Always-on hosting** — same image on a DigitalOcean droplet; optional `getUpdates → webhook`.
- [ ] **Two-stage routing** — domain-narrowing before the LLM when the registry grows large.

---

## SRC gap check (addressed in the spec)

- Persistence: inbox/outbox/conversations/command_log/api_settings ✓
- Config: per-API include + dataIntegrity in Settings; LLM model fixed (gpt-4o-mini) ✓
- Error paths: authz reject, missing params, API failure, OpenAI down, confirm-cancel ✓
- Idempotency: message_id dedupe on integrity-true ✓
- Security: chat_id authz, invoke-as-user, server-side validation ✓
- Observability: command_log + Phase 3.5 view ✓
- Drift: 1.2 drift test + Settings curation ✓
