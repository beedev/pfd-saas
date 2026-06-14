# pfd-saas (Artha) — Architecture (arc42)

> Codename **`pfd-saas`** · Product **Artha** · India-first personal-finance + GST platform,
> shipped as a **single Docker image**. Documented with the **arc42** template. Updated 2026-06-14.

**Contents**
1. Introduction & Goals · 2. Constraints · 3. Context & Scope · 4. Solution Strategy ·
5. Building Block View · 6. Runtime View · 7. Deployment View · 8. Cross-cutting Concepts ·
9. Architecture Decisions · 10. Quality Requirements · 11. Risks & Technical Debt · 12. Glossary

---

## 1. Introduction and Goals

**What it is.** A single-user-per-tenant financial command centre: investments & net worth,
Indian income tax (old vs new regime, ITR-1/2/3/4), GST business filing, goal & retirement
planning, budgeting, alerts, a daily Telegram digest, a 100-day transformation tracker, and a
**two-way Telegram assistant** that answers natural-language questions about your money.

**Top functional requirements**
- Track 13+ asset/liability classes with live valuation → net worth + history.
- Compute Indian income tax from real records (regime comparison, capital gains, ITR forms).
- GST sales/purchase invoicing + GSTR-1/3B summaries.
- Plan goals & retirement (year-by-year corpus projection); budget with auto-synced actuals.
- Proactively notify (alerts, daily digest) and converse (Telegram assistant) over Telegram.

**Quality goals** (priority order)
| # | Quality | Why it drives the architecture |
|---|---|---|
| 1 | **Correctness** of money/tax | Integer-paisa model; single-source-of-truth engines; LLM never invents numbers |
| 2 | **Data safety** | Auto-backup before every migration; one-volume backup; restore sentinel |
| 3 | **Operability** (self-host) | One container, no external deps; in-container scheduler |
| 4 | **Privacy** | Data stays on the user's machine; Postgres localhost-only |
| 5 | **Reliability** of the assistant | Grounded RAG, idempotent writes, single poller, atomic claim |

**Stakeholders:** the single operator/owner (primary user), and (future) self-host installers
pulling the public image.

---

## 2. Architecture Constraints

| Constraint | Consequence |
|---|---|
| **Ship as one Docker image**, no external services | Embedded PostgreSQL 17 + Next.js + scheduler + poller in one container |
| **India-first finance** | Paisa money model, FY `YYYY-YY`, GST period `MMYYYY`, Indian ₹ grouping, ITR/GST rules |
| **Single operator per install (self-host)** | App-wide secrets editable in-UI, persisted to the volume; click-to-sign-in |
| **Also runnable as multi-tenant SaaS** | Same codebase, switched by env (`isSelfHost()` / `DEMO_PERSONAL_SWITCH`) |
| **Offline-first / privacy** | All state in `/data`; Postgres bound to `127.0.0.1` only |
| **Next.js 16 App Router** | `output: standalone`; middleware is `proxy.ts`; database sessions can't validate in Edge |
| **Telegram: one `getUpdates` consumer per bot** | Exactly one poller; assistant bot must differ from the Claude Code bot |

---

## 3. Context and Scope

**System context**

```
                         ┌───────────────────────────┐
        Browser ───────▶ │                           │ ◀─── Telegram (user's phone)
   (operator UI)         │      Artha container       │
                         │  Next.js + PostgreSQL 17   │
        Telegram Bot ◀──▶│  + scheduler + poller      │──▶ Yahoo Finance (quotes, FX, gold)
        (getUpdates/     │                            │──▶ AMFI / mfapi.in (MF NAV)
         sendMessage)    │                            │──▶ IBJA/Yahoo (gold rate)
                         │                            │──▶ OpenAI (gpt-4.1 — assistant)
                         │                            │──▶ ET RSS (digest news)
                         │                            │──▶ SMTP (magic-link, SaaS mode)
                         └───────────────────────────┘
```

**In scope:** personal finance, Indian tax, GST filing prep, planning, the Telegram assistant,
self-host distribution.
**Out of scope:** actual money movement/brokerage execution, e-filing submission to the tax/GST
portals (it prepares data + packs), real-time market streaming.

**External interfaces:** Yahoo Finance v8 (quotes/FX/gold futures), AMFI NAVAll.txt + mfapi.in,
IBJA/Yahoo gold, OpenAI chat/completions, Telegram Bot API, ET RSS, SMTP (optional).

---

## 4. Solution Strategy

| Goal | Strategy |
|---|---|
| Zero-dependency install | **Single container**: `postgres:17-alpine` base runs embedded PG + Next standalone + two background tick loops, orchestrated by `docker-entrypoint.sh` |
| Correct money & tax | **Integer paisa** everywhere; **single-source-of-truth** functions (`computeNetWorth`, `computeFyTaxComparison`, `deriveDeductions`, `assets/registry`) reused by pages, reports, and the assistant |
| Multi-tenancy without complexity | **Per-row `userId`** on a shared schema (not schema-per-tenant); server-side `auth()` + `auth-guard` |
| Data durability | **Auto-backup before migrations** (last 7) + maintenance-sentinel restore; one-volume backup |
| Flexible NL assistant without hallucinated numbers | **Deterministic data providers + grounded RAG**: tools return raw rupee data, the LLM only filters/formats |
| One codebase, two products | **`isSelfHost()`** toggles UI-managed secrets + the account switcher |

---

## 5. Building Block View

### Level 1 — inside the container
- **Next.js app** (`server.js` standalone) — UI (App Router pages) + API routes.
- **PostgreSQL 17** — embedded, `127.0.0.1:5432`, scram-sha-256.
- **Cron ticker** — `POST /api/cron/tick` every 60s.
- **Telegram ticker** — `POST /api/telegram/tick` every 5s.
- **Volume `/data`** — `pgdata/`, `.secrets/`, `uploads/`, `backups/`, `pgsocket/`.

### Level 2 — domain modules (11 sidebar sections)
Overview · Investments · Insurance · Liabilities · Planning · Personal (transformation) ·
Income Tax · GST · Analytics · Reports · Settings. *(GST and Transformation are opt-in modules.)*

### Level 2 — the financial engines (`src/lib/`)
| Engine | Responsibility |
|---|---|
| `assets/registry.ts` | Declarative registry of 10 asset classes + liabilities; `computeNetWorth()` |
| `finance/tax-compute.ts` | `computeFyTaxComparison()` — old-vs-new regime, the tax single source of truth |
| `finance/deduction-engine.ts` | Every Chapter VI-A bucket derived from real records |
| `finance/tax-slabs.ts` / `tax-rules.ts` | Pure slab/rebate/surcharge/cess engine; FY-configurable caps |
| `finance/capital-gains-tax.ts` | LTCG/STCG (Finance Act 2024 cutoff), CII indexing |
| `finance/goal-corpus.ts` + `goal-projection.ts` | Goal corpus mapping + year-by-year projection |
| `finance/cashflow-derivation.ts` | Future cashflow events feeding goals/retirement |
| `reports/data/fetchRetirementProjection.ts`, `retirement-tax.ts` | Retirement corpus + tax |
| `finance/budget-sync.ts` | Recompute budget actuals from SIP/chit/card sources |
| `finance/xirr.ts`, `chit-xirr.ts`, `fd.ts`, `small-savings.ts` | Investment maths |
| `services/{yahoo-finance,amfi,ibja,telegram,statement-parsers}.ts` | Live data + ingestion |
| `telegram-assistant/*` | Registry · reads · llm · compose · worker · poll/send |
| `reports/*`, `portability/*` | PDF/XLSX/CSV reports; JSON export/import |

### Level 2 — data model (88 tables, all `userId`-scoped)
| Domain | Tables |
|---|---|
| Identity/config | `user`, `session`, `user_preferences`, `business_profile` |
| Investments | `holdings`, `mutual_funds`, `sips`, `gold_holdings`, `nps_accounts`, `epf_accounts`, `small_savings_accounts`(+`_transactions`), `fixed_deposits`, `forex_deposits`, `real_estate`(+`rental_history`), `chit_funds`(+`chit_fund_installments`), `investment_transactions` |
| Insurance/vehicles | `insurance_policies`, `health_insurance_*`, `vehicles`(+`vehicle_*`) |
| Liabilities | `liabilities`, `credit_card_expenses`, `loan_amortization` |
| Income tax | `tax_slabs`, `tax_regime_config`, `tax_rules`, `cost_inflation_index`, `tax_deductions`, `tax_documents`, `tax_section_preferences`, `capital_gains`, `income_tax_paid`, `tax_payments`, `salary_income`, `tds_credits`, `advance_tax_installments`, `itr_form_selection`, `presumptive_income`, `other_sources_income`, `fy_close_status` |
| GST/business | `customers`, `vendors`, `sac_codes`, `invoices`, `invoice_items`, `purchase_invoices` |
| Planning | `financial_goals`, `projection_categories`, `projection_entries`, `carryforward_balances`, `savings_asset_inclusion`, `asset_class_returns`, `cashflow_events`, `future_savings_plan`, `yearly_investment_plan`, `retirement_assumptions`, `retirement_asset_selection` |
| Budget | `budget_categories`, `budget_entries`, `recurring_expenses`, `budget_carry_forward` |
| Markets | `price_snapshots` (also net-worth snapshots) |
| Alerts | `alert_rules`, `alert_history` |
| Transformation | `transformation_plans/_sections/_items/_days/_checks` |
| Scheduler | `scheduled_jobs` |
| Telegram assistant | `telegram_inbox/_outbox/_conversations/_command_log`, `assistant_api_settings` |

---

## 6. Runtime View

**6.1 Authenticated request.** Edge `proxy.ts` checks the session cookie *exists* (presence-only,
because DB sessions can't validate in Edge) → route handler calls `auth()` →
`getSessionUserId()` → every query scoped `WHERE userId = …`.

**6.2 Boot sequence.** initdb (first run) → generate/load secrets → start Postgres → ensure DB →
**auto-backup (`pg_dump` → last 7)** → `drizzle-kit migrate` → start cron + telegram tickers →
`exec node server.js`.

**6.3 Cron tick (60s).** `/api/cron/tick` (bearer `CRON_SECRET`) selects `scheduled_jobs` due now →
runs `daily_digest` / `alerts_check` / `sip_auto_execute` → advances `next_run_at`.
- *Daily digest:* portfolio Δ vs prior snapshot + market pulse + due items + news → Telegram.
- *SIP auto-execute:* execute due SIPs at the correct historical NAV → transactions → recompute totals/XIRR → budget sync.

**6.4 Telegram assistant message.**
```
getUpdates ─▶ telegram_inbox ─▶ processInbox: rate-limit → authz (chat_id→userId)
   → resolve pending(slot/confirm/choice)
   → route (gpt-4.1 function-call → one capability, or disambiguate)
   → READ: invoke (raw rupee data) → compose (LLM, grounded in data, ₹ Indian grouping)
     WRITE: confirm → (yes) → invoke (idempotent; integrity-true deduped by message_id)
   → telegram_outbox ─drain─▶ sendMessage
```
Each inbox row is claimed with an atomic `pending→processing` update (row lock) so overlapping
ticks can't double-send.

---

## 7. Deployment View

```
GitHub (main / v*) ──CI (multi-arch amd64+arm64)──▶ ghcr.io/beedev/pfd-saas:latest
                                                          │ docker pull
   install/artha.sh  ──────────────────────────────────▶ docker run -p 9999:3000 -v artha-data:/data
                                                          ▼
                                          ┌──────── Artha container ────────┐
                                          │ Postgres 17 · Next · scheduler  │
                                          │ Volume: artha-data → /data      │
                                          └─────────────────────────────────┘
```

- **CI** `.github/workflows/docker-publish.yml`: push to `main`/tag → build multi-arch → publish GHCR.
- **Install kit** `install/` (`artha.sh`/`artha.bat`): install/start/stop/**update**/backup/restore/uninstall; `update` = pull + recreate, volume kept.
- **Production now:** container **`vaspar-pfd`** on **:9999**, volume `vaspar-pfd-data`, real personal account, assistant on **@pfdsaasbot**; runs a locally-built `vaspar-pfd:latest` (same code as GHCR `latest`).
- **Backups:** boot `pre-migrate-*.dump` (×7) + `artha.sh backup` + in-app JSON export; restore via `/data/.maintenance` sentinel.

---

## 8. Cross-cutting Concepts

- **Money** — integer **paisa** in `bigint`; rupees only at the API/UI boundary (`paisaToRupees`).
- **Multi-tenancy** — per-row `userId` (FK→`user.id`) on every tenant table; `auth-guard` convention.
- **Time** — dates text ISO `YYYY-MM-DD`; FY `YYYY-YY` (one global selector via `FinancialYearProvider`, `pfd-fy` cookie, shown only on tax/income pages); GST period `MMYYYY`.
- **Auth** — Auth.js v5, **database sessions**, magic-link (nodemailer); self-host adds the Demo/Personal switch (stable UUIDs).
- **Secrets** — generated/persisted in `/data/.secrets/` (`auth_secret`, `cron_secret`, `telegram_bot_token`, `openai_api_key`, `app_owner`); self-host can edit app-wide keys in-UI.
- **Background auth** — tick endpoints use `Authorization: Bearer <CRON_SECRET>` (constant-time).
- **Live data** — Yahoo/AMFI/IBJA with in-memory caches (5-min/1-h); native→paisa at boundary.
- **Assistant grounding** — reads return raw data; the LLM filters/formats only, never invents values; deterministic `renderRaw` fallback when no key.
- **Reports & portability** — registry-driven PDF/XLSX/CSV; full JSON export/validated import.
- **Self-host vs SaaS** — `isSelfHost()` = `SELF_HOST ∨ DEMO_PERSONAL_SWITCH ∨ TELEGRAM_CONNECT_MODE='getupdates'`.

---

## 9. Architecture Decisions (ADRs, condensed)

| # | Decision | Rationale | Trade-off |
|---|---|---|---|
| 1 | Single self-contained container (embedded PG) | One-command install, one-volume backup, no external deps | Vertical scale only; not for large multi-tenant load |
| 2 | Money as integer paisa | No float drift in financial maths | Conversions needed at boundaries |
| 3 | Per-row `userId` multi-tenancy, presence-only edge proxy | Simple shared schema; real authz server-side | Discipline required — every query must scope `userId` |
| 4 | One codebase, self-host **and** SaaS via env | Single product line | Mode-specific branches (`isSelfHost`) to maintain |
| 5 | Single-source-of-truth engines reused everywhere | Consistency across UI/reports/assistant | Engines must stay pure & well-tested |
| 6 | Assistant = deterministic providers + grounded LLM | Flexible NL with no hallucinated numbers | Two LLM calls/read; gpt-4.1 for filtering precision |
| 7 | Auto-backup before every migration + restore sentinel | Safe in-place updates | Extra boot time + volume space (capped at 7) |

---

## 10. Quality Requirements

| Quality | How it's met | Verification |
|---|---|---|
| Money correctness | Integer paisa; single-source engines; LLM grounded | `smoke:tax`; assistant returns exact, grounded ₹ |
| Data safety | Pre-migration auto-backup (×7); maintenance restore | Verified backups created on each boot |
| Update safety | Volume preserved across recreate; additive migrations | `artha.sh update` keeps data |
| Reliability (assistant) | Single poller; atomic inbox claim; idempotent writes; dedup | No double-sends under overlapping ticks |
| Security/privacy | PG localhost-only + scram; bearer-auth ticks; data on-device | — |
| Maintainability | Drizzle migrations; typed schema; registry-driven reads/reports | `db:verify`, `tsc`, eslint |

---

## 11. Risks and Technical Debt

- **`@dxp/ui` triplication** — a `file:` workspace dep, a node_modules symlink, **and** the vendored
  `src/lib/dxp-ui/` (the one actually compiled via `transpilePackages`); the `file:` link is stale.
- **Drizzle snapshots `0028`–`0037` missing** (hand-edited SQL) — `drizzle-kit generate` can't cleanly diff that span; those are manual checkpoints.
- **`.env.example` uses legacy `NEXTAUTH_URL`**; runtime reads `AUTH_URL`.
- **Prod runs a locally-built image**, not the published GHCR artifact — same code, but won't track `./artha.sh update` until repointed at `ghcr.io/beedev/pfd-saas:latest`.
- **Scale ceiling** — single container/embedded PG is vertical-scale only (acceptable for the single-operator model).
- **Third-party data coupling** — Yahoo/AMFI/IBJA are unofficial endpoints; cached + fallback-chained but can break.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Paisa** | 1/100 of a rupee; the integer money unit stored in DB |
| **FY** | Indian financial year, `YYYY-YY` (Apr–Mar) |
| **MMYYYY** | GST return-period key (e.g. `062026`) |
| **ITR-1/2/3/4** | Indian income-tax return forms (the app prepares summaries + a filing pack) |
| **GSTR-1 / GSTR-3B** | GST outward-supplies / summary returns |
| **LTCG / STCG** | Long-/short-term capital gains |
| **XIRR** | Extended internal rate of return (irregular cashflows) |
| **CII** | Cost Inflation Index (capital-gains indexation) |
| **Chapter VI-A** | Income-tax deductions (80C/80D/80CCD(1B)/…) |
| **RAG** | Retrieval-augmented generation — assistant answers grounded in fetched data |
| **dataIntegrity** | Registry flag: `true` ⇒ write is slash-only + deduped; `false` ⇒ LLM-eligible |
| **Self-host** | Single-operator mode; app-wide secrets editable in-UI, persisted to `/data` |
| **Demo / Personal** | The two self-host accounts (stable UUIDs) the switcher toggles |
| **Tick** | A scheduled `POST` to `/api/cron/tick` (60s) or `/api/telegram/tick` (5s) |
</content>
</invoke>
