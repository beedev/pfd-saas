# Audit Remediation Progress — loop checkpoint

Source: `2026-06-10-security-architecture-audit.md` · Loop: "fix the bugs and test them for compliance continue till done"
Rules: local commits only (NO push), no :3001 container recreate, build + smoke gates per commit, migrations hand-authored under drizzle/ + journal.

## Status legend: [ ] pending · [~] in progress · [x] done · [U] user action needed · [A] accepted risk

## Accepted risk (do not fix)
- [A] S1 account switcher default · [A] S2 magic-link ui mode · [A] S3 magic-links.log

## P0
- [U] S4 rotate .env.local secrets (AUTH_SECRET, Gmail app pwd, Telegram token, CRON_SECRET, OpenAI key) — external consoles, user must do
- [x] S5 next 16.1.1 → 16.2.9 (commit 23a5e53)
- [x] S6 drizzle-orm → 0.45.2 (commit 23a5e53)

## P1
- [x] S8 tax-doc download: attachment + safe-MIME + nosniff + filename sanitize (commit 357130d)
- [x] S9 upload size cap + type allowlist (tax/documents 25MB, form-16/26as 5MB PDF-only) (commit 357130d)
- [x] S10 financialYear regex validation in tax/documents (commit 357130d)
- [x] A2 tax-doc storage → uploads/<userId>/finance/... + refcounted unlink; legacy paths still resolve, no file migration needed (commit 357130d)
- [x] S7 xlsx → exceljs (5f4fd2e) — parser + 7 report writers; equivalence-tested vs TaxCalc_2027.xlsx; xlsx uninstalled, last HIGH advisory gone
- [x] A1 snapshot chain rebuilt via 0038 snapshot-sync; second generate run clean (80af714)

## P2
- [x] S11 metadata-driven per-column validator + unknown-key strip/count; offline test 12/12 (611da84)
- [ ] S12 parseBody(schema) helper + top mutation routes
- [~] S13 security headers in next.config — nosniff/XFO/Referrer/HSTS done (c47fc6b); CSP deferred (needs browser testing)
- [U] S14 nodemailer — advisory now covers <=8.0.4, NO fix available upstream; revisit when nodemailer ships a patch
- [x] S15 pg_hba → scram-sha-256, both boot paths safe (2f7e142)
- [x] A3 gstin → (user_id, gstin) via migration 0038; applies on next container recreate (80af714)
- [x] A4 tds_credits partial idx declared + payment_date date mode:string (80af714)
- [x] A5 FY-window consolidated, 11 sites, -255 lines (3ea7fbe)
- [x] A6 itr3-summary.ts extracted, payload identical (3ea7fbe)
- [x] A7 retirement-shared.ts + 24(b) into lib + PF 4th copy (bfbf8bd); lookup helpers + compound() left split (behavior-divergent, documented)
- [x] A8 userId-first on 6 sites + confirm-route reconstructions + CLAUDE.md (3ea7fbe); residual: portability dir (fold into S11 batch)

## P3
- [x] S16 amfi (c47fc6b) · [x] S17 wipe-demo-data parameterize (c47fc6b) · [x] S18 timingSafeEqual (c47fc6b) + pairing rate limit (2f7e142) · [x] S19 health generic error (c47fc6b) · [x] S20 .dockerignore (c47fc6b) · [~] S21 npm audit fix applied 17→11 vulns (23a5e53); drizzle-kit esbuild chain needs breaking bump — deferred · [x] S22 build ARG (2f7e142) · [x] S23 exact pins (2f7e142)
- [ ] A9 requireUserId() helper · [x] A10 alias codemod, 11 files (2f7e142) · [x] A11 (2f7e142) · [x] A12 PF_ANNUAL_RATE_PCT (2f7e142)

## Blocked / user actions
- Smoke suite (smoke-test-tax/portability) requires `DEV_AUTH_BYPASS=true npm run dev` — permission classifier blocks Claude starting it. User: run `! cd /Users/bharath/Desktop/pfd-saas && DEV_AUTH_BYPASS=true npm run dev` in the session, or add a Bash allow rule. Until then the compliance gate per commit = `npm run build` (type-checked) — all green so far.
- S4 secret rotation — user, external consoles.

## Log
- 2026-06-10: checkpoint created; starting P0 (S5+S6)
- 2026-06-10: 23a5e53 deps (S5,S6,S21p) · 357130d tax-docs cluster (S8,S9,S10,A2) · c47fc6b P3 batch (S13p,S16-S20) — builds green; smoke pending user-enabled dev server
- 2026-06-10: 5f4fd2e S7 xlsx→exceljs (14 files, equivalence-tested) — all HIGHs now closed
- next up: A1 snapshot reconstruction + A3 gstin + A4 tds_credits as one migration-cluster (fix schema A4/A3 first, then drizzle-kit generate snapshot-sync 0038, trim duplicate DDL); then A5-A8 extractions, S11/S12, S15, S22/S23, A9-A12
- 2026-06-10: 80af714 migration cluster A1+A3+A4 — snapshot chain healed, drift zero
- next up: small-mechanical batch (S15, S22, S23, S18-rest, A10, A11, A12), then extractions A5/A6/A8, then A7, S11, S12, A9
- 2026-06-10: 2f7e142 small-mechanical batch (S15,S18r,S22,S23,A10-A12) + orphaned schema-hash artifact committed
- follow-up noted by agent: 4th PF 8.25 copy in goal-corpus.ts DEFAULT_RETURN_PCT_BY_CLASS; rate-table drift between asset-class-returns defaults and constants file (pre-existing)
- next up: extractions A5 (fyBounds x11), A6 (itr3-summary lib), A8 (upload path ordering); then A7, A9, S11, S12
- 2026-06-10: 3ea7fbe extraction batch A5+A6+A8 — build green
- next up: S11 portability per-column zod validation + portability upload dir userId-first; then A7 retirement-shared dedup (+4th PF copy, rate-table drift); then S12 parseBody + A9 requireUserId
- 2026-06-10: 611da84 S11 + portability upload dir userId-first — A8 now fully closed
- next up: A7 retirement-shared dedup (incl. 4th PF copy + rate-table drift); then final batch S12 parseBody + A9 requireUserId
- 2026-06-10: bfbf8bd A7 dedup — NEW DECISION ITEM for user: GOLD/NPS/RE rate drift between asset-class-returns seed (9/9.5/6) and DEFAULT_GROWTH_RATES (8/9/5) is accidental per git history; un-seeded users get inconsistent projections; pick canonical values
- next up: FINAL batch — S12 parseBody zod helper + A9 requireUserId, adopt across top mutation routes
