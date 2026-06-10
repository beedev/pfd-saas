# Audit Remediation Progress — loop checkpoint

Source: `2026-06-10-security-architecture-audit.md` · Loop: "fix the bugs and test them for compliance continue till done"
Rules: local commits only (NO push), no :3001 container recreate, build + smoke gates per commit, migrations hand-authored under drizzle/ + journal.

## Status legend: [ ] pending · [~] in progress · [x] done · [U] user action needed · [A] accepted risk

## Accepted risk (do not fix)
- [A] S1 account switcher default · [A] S2 magic-link ui mode · [A] S3 magic-links.log

## P0
- [U] S4 rotate .env.local secrets (AUTH_SECRET, Gmail app pwd, Telegram token, CRON_SECRET, OpenAI key) — external consoles, user must do
- [ ] S5 next 16.1.1 → 16.2.9+
- [ ] S6 drizzle-orm → 0.45.2

## P1
- [ ] S8 tax-doc download: attachment + octet-stream + nosniff + filename sanitize
- [ ] S9 upload size cap + type allowlist (tax/documents, form-16, form-26as)
- [ ] S10 financialYear regex validation in tax/documents
- [ ] A2 tax-doc storage → uploads/<userId>/finance/... + safe unlink (+ file migration script)
- [ ] S7 xlsx@0.18.5 → exceljs (yeswanth-parser) + re-verify field mapping
- [ ] A1 drizzle meta snapshots 0028–0037 reconstruction

## P2
- [ ] S11 portability import per-column zod validation
- [ ] S12 parseBody(schema) helper + top mutation routes
- [ ] S13 security headers in next.config
- [ ] S14 nodemailer → 8.0.4 (verify next-auth compat)
- [ ] S15 pg_hba trust → scram-sha-256
- [ ] A3 business_profile.gstin unique → (user_id, gstin) migration
- [ ] A4 tds_credits: declare partial unique idx in schema + payment_date type align
- [ ] A5 consolidate FY-window helpers (11 sites)
- [ ] A6 extract itr3-summary.ts lib
- [ ] A7 retirement-shared.ts extraction (4 routes) + 24(b) vintage into section-24b.ts
- [ ] A8 upload path ordering standardize userId-first + rewrite script

## P3
- [ ] S16 amfi encodeURIComponent + ^\d+$ · [ ] S17 wipe-demo-data parameterize · [ ] S18 timingSafeEqual + pairing rate limit · [ ] S19 health generic error · [ ] S20 .dockerignore bare .env · [ ] S21 drizzle-kit bump · [ ] S22 Dockerfile build-arg secret · [ ] S23 pin security deps
- [ ] A9 requireUserId() helper · [ ] A10 providentFund alias codemod · [ ] A11 stale comments · [ ] A12 PF rate single constant

## Log
- 2026-06-10: checkpoint created; starting P0 (S5+S6)
