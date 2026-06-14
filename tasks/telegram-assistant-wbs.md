# WBS — Telegram Assistant

Spec: `docs/PLAN-telegram-assistant.md`. Tasks are baton-passing: each has an
explicit **output** and a **verify** step so the next task can start cleanly.
Check items off as they land.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 0 — Plumbing (no LLM). Goal: a provably reliable slash-command bot.

- [x] **0.1 Tick loop wired into the scheduler**
  - Output: `docker-entrypoint.sh` now runs a dedicated **telegram ticker** — a backgrounded loop POSTing `/api/telegram/tick` every `TELEGRAM_TICK_SECONDS` (default 5), independent of `DISABLE_CRON`, opt-out via `DISABLE_TELEGRAM_TICK`. Single getUpdates consumer (don't also run an external poller). Bot is `@pfdsaasbot`.
  - Verify: ✅ `getMe`→pfdsaasbot; ✅ container logs "Telegram assistant ticker ON (every 5s)"; ✅ a real "what is my networth" was polled+answered with no manual tick.

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

- [x] **1.2 Drift guard** (adapted — capabilities use `invoke()`, not paths, so the "path resolves to a route" check doesn't apply)
  - Output: `assertRegistryIntegrity()` in `registry.ts` — fails on duplicate ids, duplicate/mis-typed slash commands, unnamed params, bad kind. Called once per `processInbox`, so drift fails loudly (tick → 500) on first run. TypeScript already covers the param-shape contract.
  - Verify: ✅ runs clean each tick on the valid registry; a deliberate dup slash/id throws with a clear message.

- [x] **1.3 Wire v1 slash commands from the registry** (the safe/clean set)
  - Output: `/networth /paid /due /today /weight /tick /tax` all registry-driven. Deferred — `/inspaid` (date-advancing → integrity), `/chitpay` (dividend math), `/meal` (nutrition + append): each needs its own design; tracked under 3.4.
  - Verify: ✅ each wired command runs end-to-end (slash + free-text where eligible); integrity `/paid` confirms + dedupes.

- [x] **1.4 Settings — "Assistant APIs" screen**
  - Output: `getEffectiveCapabilities(userId)` merge (`effective.ts`) the worker + LLM router now route through; `GET/PATCH /api/settings/assistant-apis`; `AssistantApisForm` card (Include-in-assistant + AI-eligible/Slash-only toggles) wired into Settings.
  - Verify: ✅ exclude `get_net_worth` → free-text `no-match` + `/networth` "Unknown command"; ✅ flip `mark_card_paid` integrity true→false → free-text routed via LLM to `awaiting-confirm` (was `blocked-integrity`), no double-pay. Also closed the failed-invoke audit-log gap (`runAndReply` logs error rows).

**Phase 1 exit:** the surface is registry-driven and user-curated; drift-guarded.

---

## Phase 2 — LLM agent (reads + non-integrity writes)

- [x] **2.1 LLM router**
  - Output: build OpenAI function-call tools from **included + dataIntegrity=false** capabilities; map a free-text message → `{capabilityId, args}` | clarify | none.
  - Verify: "what's my net worth" → `get_net_worth`; "log breakfast: idli" → `log_meal` with extracted args; gibberish → graceful "I didn't get that".

- [x] **2.2 Slot-fill loop**
  - Output: shared `dispatch()` — missing required param ⇒ `askSlot` persists `awaiting:'slot'` + asks; the next reply fills the first-missing param, re-dispatches (re-slot → confirm → execute). 10-min TTL; "cancel" abandons. Used by slash, LLM and slot-completion paths alike.
  - Verify: ✅ `/weight` (no arg) → "What's the kg?" → `82` → confirm → `yes` → logged 82 (command_log: `awaiting-slot` → `awaiting-confirm` → `ok`).

- [x] **2.3 Result formatting (echo + summary/full)**
  - Output: kept **deterministic** `formatResult` (reliability > LLM prose) with a `verbose` flag — "detail/full/breakdown" expands (net worth adds liabilities). LLM-routed reads get a `🔎 _<summary>_` echo of what was understood.
  - Verify: ✅ "what is my net worth in detail" → echo line + `_Liabilities_` section; concise without the keyword.

- [x] **2.4 Ship read + non-integrity-write capabilities**
  - Output: `get_due_payments` (`/due`, lib `finance/due-payments.ts`), `get_today_status` (`/today`), `log_weight` (`/weight`), `tick_habit` (`/tick`) — last two idempotent writes in new lib `health/transformation-actions.ts`. Deterministic `formatResult` for each. (log_meal+nutrition deferred — append/duplicate-risk, see 3.4.)
  - Verify: ✅ slash + free-text both route each; ✅ "log my weight as 80 kg" → log_weight kg=80 → confirm → DB=80; ✅ `/tick 3 ltr` twice → exactly 1 checked row (idempotent); ✅ ambiguous `/tick water` → "be more specific" (audit-logged error); ✅ writes still confirm; integrity-true `mark_card_paid` stays slash-only.

**Phase 2 exit:** the conversational assistant is live for the safe surface.

---

## Phase 3 — Hardening & polish

- [x] **3.1** Rate-limiting per chat — in-memory sliding window (20 msg / 60s) in the worker; over-limit → "give me a minute" + `rate-limited` log. (Logic-reviewed + typechecked; not load-spam-tested to spare the live chat.)
- [x] **3.2** Richer error UX — invoke failures audit-logged + reply "you can try again, or use a slash command — /help"; OpenAI-not-configured / no-eligible-actions handled gracefully.
- [x] **3.3** Cancel/redo affordances — slot prompt accepts "cancel"; confirm is "yes-or-cancel"; both expire after 10 min.
- [ ] **3.4** Expand the capability set further — **deferred**: `log_meal` (+nutrition estimate, append/duplicate-risk), `/inspaid` (insurance mark-paid, date-advancing → integrity), `/chitpay` (installment + dividend math). Each needs its own design pass.
- [x] **3.5** Observability — `GET /api/settings/assistant-log` + `AssistantActivityCard` in Settings (recent requests, route, capability, outcome).
- [ ] **3.6** Help docs: add an "Assistant" page to the in-app Help Center. **(open)**

**Phase 3 exit:** safe surface is hardened, observable, and user-curated. Remaining open: 3.4 (more capabilities, by design), 3.6 (help page), 0.1 (wire the always-on tick loop into the scheduler).

---

## Tracked follow-ups (NOT part of this feature)

- [x] **Settings IA redesign** — done: tabbed Settings (Profile & Tax / Assistant / Projections / Data) via `SettingsTabs`; Assistant tab houses Telegram + Assistant APIs + Activity + OpenAI key.
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
