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
- [ ] A1 drizzle meta snapshots 0028–0037 reconstruction

## P2
- [ ] S11 portability import per-column zod validation
- [ ] S12 parseBody(schema) helper + top mutation routes
- [~] S13 security headers in next.config — nosniff/XFO/Referrer/HSTS done (c47fc6b); CSP deferred (needs browser testing)
- [U] S14 nodemailer — advisory now covers <=8.0.4, NO fix available upstream; revisit when nodemailer ships a patch
- [ ] S15 pg_hba trust → scram-sha-256
- [ ] A3 business_profile.gstin unique → (user_id, gstin) migration
- [ ] A4 tds_credits: declare partial unique idx in schema + payment_date type align
- [ ] A5 consolidate FY-window helpers (11 sites)
- [ ] A6 extract itr3-summary.ts lib
- [ ] A7 retirement-shared.ts extraction (4 routes) + 24(b) vintage into section-24b.ts
- [ ] A8 upload path ordering standardize userId-first + rewrite script

## P3
- [x] S16 amfi (c47fc6b) · [x] S17 wipe-demo-data parameterize (c47fc6b) · [~] S18 timingSafeEqual done (c47fc6b), telegram pairing rate limit pending · [x] S19 health generic error (c47fc6b) · [x] S20 .dockerignore (c47fc6b) · [~] S21 npm audit fix applied 17→11 vulns (23a5e53); drizzle-kit esbuild chain needs breaking bump — deferred · [ ] S22 Dockerfile build-arg secret · [ ] S23 pin security deps
- [ ] A9 requireUserId() helper · [ ] A10 providentFund alias codemod · [ ] A11 stale comments · [ ] A12 PF rate single constant

## Blocked / user actions
- Smoke suite (smoke-test-tax/portability) requires `DEV_AUTH_BYPASS=true npm run dev` — permission classifier blocks Claude starting it. User: run `! cd /Users/bharath/Desktop/pfd-saas && DEV_AUTH_BYPASS=true npm run dev` in the session, or add a Bash allow rule. Until then the compliance gate per commit = `npm run build` (type-checked) — all green so far.
- S4 secret rotation — user, external consoles.

## Log
- 2026-06-10: checkpoint created; starting P0 (S5+S6)
- 2026-06-10: 23a5e53 deps (S5,S6,S21p) · 357130d tax-docs cluster (S8,S9,S10,A2) · c47fc6b P3 batch (S13p,S16-S20) — builds green; smoke pending user-enabled dev server
- 2026-06-10: 5f4fd2e S7 xlsx→exceljs (14 files, equivalence-tested) — all HIGHs now closed
- next up: A1 snapshot reconstruction + A3 gstin + A4 tds_credits as one migration-cluster (fix schema A4/A3 first, then drizzle-kit generate snapshot-sync 0038, trim duplicate DDL); then A5-A8 extractions, S11/S12, S15, S22/S23, A9-A12
