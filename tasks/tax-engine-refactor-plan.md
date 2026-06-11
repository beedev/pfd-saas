# Tax Engine + Asset Registry Refactor — plan

**Branch:** `feat/tax-engine-refactor` (off SaaS main @ form-16 baseline `a3285c7`)
**Rollback:** abandon this branch → main is pristine. SaaS main is NOT pushed (held — GHCR :latest would publish test-mode insecure defaults; re-open trigger for S1/S2).
**Gate per phase:** `npm run build` + `node scripts/smoke-test-tax.mjs <userId> <fy>` + `node scripts/smoke-portability.mjs <userId>` must pass. Commit per phase.
**Parity:** SaaS first (multi-tenant: userId-scope every query, `await auth()` gate, Postgres bigint paisa, `epfAccounts` not `providentFund`). Back-port the unified engine to V1 after SaaS proves it.

## Why (evidence)
- Deduction derivation (records → Chapter VI-A) is DUPLICATED across tax/summary + regime-compare; ITR forms source independently. Adding an 80C source = edit ~4 places.
- No shared tax-compute pipeline; itr3 computes inline (no lib). regime-compare/itr/position each re-assemble income+deductions+slabs.
- networth/snapshot hardcodes 12 asset selects; savings/retirement/corpus/goals are copy-paste quadruplets; no asset registry.
- Parsers: a real registry exists (statement-parsers: lic/chit/mf/epf/nps) but Form 16, 26AS, Yeswanth-xlsx live outside it; capital-gains-statement ingestion doesn't exist.

## Modules (target)
1. **Deduction Engine** `lib/finance/deduction-engine.ts` — `deriveDeductions(userId, fy) → {buckets, oldTotal, newTotal, breakdown}`. One source of truth (EPF/LIC/NPS/ELSS/SGB/loan→80C/80CCD1B; health→80D incl health_insurance_policies; donations→80G eligible via helper). Consumed by tax/summary, regime-compare, ITR.
2. **Income Resolver** `lib/finance/income-engine.ts` (absorbs form16-tax-source) — `resolveIncome(userId, fy) → {salary(Form16-authoritative), other, business, houseProperty, capitalGains}`.
3. **Tax-Compute Pipeline** `lib/finance/tax-compute.ts` — `computeTaxForFy({income, deductions, regime, fy}) → TaxResult` (+ aggregate equity LTCG). regime-compare runs OLD/NEW; ITR + position consume it. Extract itr3 to lib.
4. **Asset Registry** `lib/assets/registry.ts` — `ASSET_CLASSES: AssetDescriptor[]` {key,label,fetch,valuePaisa,project,taxContribution}. networth/projections/retirement/goals iterate it.
5. **Ingestion Engine** `lib/ingestion/` — one StatementParser interface (detect/parse/persist) + xlsx path; onboard Form16/26AS/Yeswanth + existing 5; add capital-gains contract-note parsers (Zerodha/Groww/CAMS/KFintech) → feed aggregate-LTCG.

## Sequence
- Phase 1: Deduction Engine (folds in V1 deduction features) ← START HERE
- Phase 2: Income Resolver (folds in Form-16-authoritative + Tax Paid So Far + salary side-by-side). itr1/itr2 already partially wired (wip commit 2cb0ff6).
- Phase 3: Tax Pipeline (folds in LTCG aggregation; extract itr3)
- Phase 4: Asset Registry
- Phase 5: Ingestion Engine (+ capital-gains statements)
- Then: back-port unified engine to V1.

## V1 status (reference implementation, already shipped on V1 main, pushed)
Form16 parse/merge/HRA, Form-16-authoritative tax calc, regime-compare deduction engine (the duplicated derivation), salary side-by-side, equity-LTCG aggregation, Income→Tax nav. Commits 596303d…b2ee0cc.
