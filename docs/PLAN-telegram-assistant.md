# Plan — Two-way Telegram Assistant for Artha

Status: **Approved design, not yet built.** Last updated 2026-06-14.

A conversational layer over Artha: you text the bot, it answers (reads) or does
things (writes). Reads + status changes go through an LLM; integrity-sensitive
writes go through explicit slash commands. Every exposed endpoint is curated
from **Settings**, so the assistant's surface is something you control, not a
black box.

---

## 1. Vision & example flows

| You send | Route | What happens |
|----------|-------|--------------|
| "What's my tax position this year?" | LLM (read) | resolves FY → tax-summary → LLM formats a summary reply |
| "Log breakfast: 2 idli, sambar, coffee" | LLM (write, integrity=false) | nutrition estimate → append to today's tracker → reply |
| "Tick morning meditation" | LLM (write, integrity=false) | idempotent check → done |
| `/paid HDFC` | Slash (write, integrity=true) | confirm card + full statement amount → on ✅, mark paid |
| `/networth` | Slash (read) | deterministic net-worth reply |

"Summary by default; full detail when you ask for it."

---

## 2. Locked decisions

- **Bot:** one **dedicated** bot, `@pfdsaasbot`. Digest + alerts + assistant all use it. `@Bdclaudebot` stays the Claude Code bridge only.
- **Inbound:** `getUpdates` long-poll (works on localhost; no public endpoint). Single poller assumed (one dedicated bot, run only by the always-on instance).
- **Brain:** OpenAI function-calling (`gpt-4o-mini`), key already configured.
- **Routing:** reads + status changes → LLM. Integrity-sensitive writes → slash commands.
- **The dial — `dataIntegrity` flag per API:**
  - `false` (default): re-running is harmless → **LLM-callable**.
  - `true`: a second run corrupts data → **slash-command only** (never LLM-reachable), **+ `message_id` dedupe** so a crash/reprocess can't double it.
- **Registry:** defined in **code** (endpoint + param schema + defaults, kept honest by a drift test); **curated in Settings** (per-API *Include in assistant* + *Data integrity* toggles).
- **Safety rails:** chat_id authz, invoke-as-user, server-side validation of all args, confirm-on-write, full audit log.
- **Deliberately NOT engineered (accepted):** message-timestamp date semantics / UTC↔IST exactness; hard enforcement of exactly-one-poller (assume discipline).

---

## 3. Architecture

```
Telegram  ──getUpdates──►  Poller ──persist──►  telegram_inbox  ──►  Worker
                                                                       │
                                          authz (chat_id → user) ──────┤
                                                                       ▼
                                              ┌──────────── Router ────────────┐
                                       text "/..."                       free text
                                          │                                 │
                                     Slash parser                    LLM (function-call,
                                  (deterministic)                    integrity=false tools)
                                          │                                 │
                                          └──────────── merge ──────────────┘
                                                        │
                                          required params present?
                                              no → slot-fill prompt ──► telegram_outbox
                                              yes →
                                          write?  ── yes ──► confirm (inline ✅/✖) ──► telegram_outbox
                                              │                         (on callback)
                                              ▼                              ▼
                                          invoke API AS the user (server-side, validated)
                                                        │
                                          integrity=true? → dedupe by message_id
                                                        ▼
                                              result ──► LLM/deterministic format
                                                        ▼
                                                 telegram_outbox ──sender──► Telegram
                                                        │
                                                  (audit-logged throughout)
```

Two background loops in the always-on instance's scheduler:
1. **Poller** — `getUpdates(offset)` → write each update to `telegram_inbox` → **ack offset only after persist**.
2. **Worker** — process `telegram_inbox` rows in `update_id` order; **Sender** drains `telegram_outbox`.

---

## 4. The API registry

### 4a. Code contract (`src/lib/assistant/registry.ts`)
```ts
export type ParamType = 'string' | 'number' | 'boolean' | 'date' | 'enum';

export interface CapabilityParam {
  name: string;
  type: ParamType;
  required: boolean;
  description: string;          // helps the LLM + the slot-fill prompt
  enumValues?: string[];
  optionsFrom?: string;         // capability id whose result lists choices (disambiguation)
}

export interface Capability {
  id: string;                   // 'mark_card_paid'  (stable)
  summary: string;              // LLM-facing description
  method: 'GET' | 'POST' | 'PATCH';
  path: string;                 // '/api/.../credit-cards/:id/mark-paid'
  kind: 'read' | 'write';
  defaultDataIntegrity: boolean;// write+true ⇒ slash-only; read ⇒ false
  slashCommand?: string;        // '/paid'  (present ⇒ invokable by slash)
  params: CapabilityParam[];
  // invoke(userId, args) — thin wrapper over the existing route/lib, runs AS the user.
  invoke: (userId: string, args: Record<string, unknown>) => Promise<unknown>;
}

export const CAPABILITIES: Capability[];
```

- A **drift test** asserts every `path` resolves to a real route and (where the
  route uses zod) the `required` params match — so the registry can't silently rot.

### 4b. Settings curation (DB overrides)
`assistant_api_settings` stores per-user toggles that override the code defaults:
`included` (expose to the assistant at all) and `dataIntegrity` (false→LLM,
true→slash). Absent row ⇒ use the code default.

### 4c. v1 capability set
| id | kind | slash | dataIntegrity | notes |
|----|------|-------|---------------|-------|
| `get_tax_summary` | read | `/tax` | false | FY arg, default current |
| `get_net_worth` | read | `/networth` | false | breakdown |
| `get_due_payments` | read | `/due` | false | SIP/chit/insurance/EMI/cards |
| `get_today_status` | read | `/today` | false | habits + streak |
| `log_meal` | write | `/meal` | **false** | nutrition estimate; dup is recoverable |
| `tick_habit` | write | — | **false** | idempotent |
| `log_weight` | write | — | **false** | upsert per day → idempotent |
| `mark_card_paid` | write | `/paid` | **true** | slash-only + dedupe |
| `mark_insurance_paid` | write | `/inspaid` | **true** | slash-only + dedupe |
| `record_chit_installment` | write | `/chitpay` | **true** | slash-only + dedupe |

---

## 5. The agent / worker loop (per inbox row)

1. **Authz** — `chat_id` must match a paired `user_preferences.telegram_chat_id`. Else log + reply "not authorized", mark done.
2. **Resume pending?** — if `telegram_conversations` has an unexpired pending for this chat (slot-fill or confirm), merge this message into it.
3. **Route**
   - `/command …` → slash parser → capability by `slashCommand` + positional/keyword args.
   - free text → LLM function-call over **included + dataIntegrity=false** capabilities → `{capabilityId, args}` | `{clarify}` | `{none}`.
4. **Required-param check** (deterministic, from registry) — missing → enqueue a slot-fill question, persist pending, stop.
5. **Disambiguation** — a param with `optionsFrom` and no value → call that read, present choices.
6. **Write?** → enqueue a **confirm** message with inline ✅/✖ (callback carries a pending-id); persist pending; stop. (Reads skip this.)
7. **Invoke** — on confirm (or immediately for reads): `capability.invoke(userId, args)`; for `dataIntegrity=true`, first check the audit log for `(message_id, capabilityId)` already done → skip if so.
8. **Format** — reads/most: pass result + "summary unless full asked" to the LLM → reply text. Slash reads may format deterministically.
9. **Reply** — enqueue to `telegram_outbox`; **Sender** delivers (with retry).
10. **Audit** — write a `telegram_command_log` row at every decision point.

---

## 6. Data model (new tables)

```
telegram_inbox        update_id (uniq), chat_id, message_id, from_username, text,
                      received_at, status (pending|processing|done|error), processed_at, error
telegram_outbox       chat_id, kind (reply|confirm|notice), text, reply_markup (json),
                      created_at, status (pending|sent|error), sent_at, error
telegram_conversations chat_id (pk), pending_capability, collected_args (json),
                      awaiting (param name | 'confirm'), pending_id, expires_at
telegram_command_log  user_id, chat_id, message_id, raw_text, route (slash|llm),
                      capability_id, args (json), confirmed (bool),
                      result_status, result_summary, created_at
assistant_api_settings user_id, capability_id, included (bool), data_integrity (bool)
```

---

## 7. Security & reliability guarantees

- **chat_id authz** — only the paired user's messages act; everyone else is rejected.
- **Invoke-as-user** — every call carries the user's identity; same authz as the web app.
- **Never trust LLM args** — server-side zod validation re-runs on the real route.
- **Writes can't fire on LLM output alone** — LLM proposes, you confirm; integrity-true never touches the LLM at all.
- **No duplicate integrity writes** — `message_id` dedupe on the flagged few.
- **No lost/double messages** — ack-after-persist into `telegram_inbox`; outbox survives crashes.
- **Full audit** — every command, choice, arg, and result is logged → traceable + fixable.

### Accepted residual limits
- LLM may occasionally misread free-text intent → you Cancel/rephrase (bounded, never destructive).
- OpenAI outage → free-text pauses (inbox retries when back); **slash commands keep working** (no LLM).
- Registry is hand-maintained; the drift test guards it but it's ongoing upkeep.
- >24h downtime before a poll = those Telegram updates lost.

---

## 8. Follow-ups (separate from this feature)

- **Settings IA redesign** — the page is chaotic (~12 cards); group into sections/tabs (Profile · Tax · Modules · Integrations · Assistant/APIs · Data). The new API-registry screen lands there.
- **Always-on hosting** — same image on a small DigitalOcean droplet (~₹500–1000/mo) → ~zero downtime, real-time dates; optional `getUpdates → webhook` switch.
- **Two-stage routing** — when the registry grows large, narrow tools by domain (search) before the LLM call.

---

## 9. Work Breakdown Structure

See `tasks/telegram-assistant-wbs.md` for the trackable checklist. Phase summary:

- **Phase 0 — Plumbing (no LLM):** dedicated bot, poller + `telegram_inbox/outbox`, sender, chat_id authz, audit log, slash parser, confirm-on-write, `message_id` dedupe, and **one read (`/networth`) + one integrity write (`/paid`) end-to-end.** Provably reliable before any AI.
- **Phase 1 — Registry + invoker + Settings:** code registry (schemas) + drift test, invoke-as-user, wire all v1 slash commands from the registry, and the Settings "Assistant APIs" screen (include/exclude + dataIntegrity toggles).
- **Phase 2 — LLM agent (reads/status):** OpenAI function-calling over dataIntegrity=false capabilities, slot-fill loop, summary/full formatting; ship the read + non-integrity-write capabilities.
- **Phase 3 — Hardening & polish:** rate-limit, richer error UX, multi-turn disambiguation, more capabilities, an observability view over the command log.

Each phase ships something usable: Phase 0 = reliable slash bot; Phase 2 = the conversational assistant.
