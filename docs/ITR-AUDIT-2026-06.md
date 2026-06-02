# ITR Pages + Summary Endpoints — Audit (Sprint 5.4, 2026-06)

User scenario probed: **BXDEva** (`dcc2a010-bf3e-44e5-8b6b-9fcd3bc521d3`), FY **2025-26**.
- 3 properties (1 self-occupied Anand, 1 let-out Whitefield ₹25K/mo, 1 land Hosur)
- 4 capital-gains rows totalling ₹7,85,000 taxable gain
- 14 Section-80 deduction rows (OLD ₹6,61,800)
- 5 TDS credits
- 0 invoices, so no business income
- Wizard recommendation persisted in `itr_form_selection`: **ITR-2**

## Phase A — current vs correct rules

| Form | Current behaviour | Correct rule | Gap |
|---|---|---|---|
| **ITR-1 includes** | Salary + first `real_estate` row (by id) treated as the single HP + interest/FD/PF/dividend `other_sources_income` + Section-80 deductions + slab tax | Salary + single HP + other (interest/dividend/family pension) + agri ≤ ₹5k | First-row-only HP is a silent data hide; ignores `isSelfOccupied`; multi-property users never see why the rest of their rent vanishes |
| **ITR-1 excludes** | Capital gains (silently — no surfacing at all); other-source rows that aren't in the interest list (silently filtered); business / freelance income | All capital gains, additional HPs, business, foreign income/assets, lottery, director/unlisted shares, agri > ₹5k | None of these "skips" is surfaced. ₹7,85,000 of CG and ₹3,00,000 of additional rent disappear with no warning |
| **ITR-1 eligibility warning** | Only `exceedsCap` (gross > ₹50L) — banner pointing to ITR-2. Footer paragraph mentions the other exclusions in prose | Should warn on each ineligibility flag with the actual data value | Wizard recommendation never surfaced. CG / multi-property / business / foreign / director / agri flags never surfaced individually |
| **ITR-1 TDS scope** | Reports only salary TDS from `salary_income.tdsPaisa`. Doesn't read `tds_credits` at all in the summary endpoint (banner pulls separately) | Should include sections 192, 194A, 194, 194B/BB, 194-IB, 194P | Non-salary TDS rows are completely silent on this page; user can't tell their bank TDS is being claimed |
| **ITR-2 includes** | Salary + ALL `real_estate` rows (Schedule HP) + non-exempt `other_sources_income` + ALL `capital_gains` rows (with pre/post-Jul-24 cutoff) + Section-80 deductions | Same — salary, any number of HPs, all OS, all CG, foreign income/assets | Schedule FA (foreign assets) not captured (acceptable stub) |
| **ITR-2 excludes** | Business income (no detection — invoices ignored entirely) | Business / professional income → must switch to ITR-3 | If user has GST invoices the page silently treats them as not-business. No warning |
| **ITR-2 eligibility warning** | None. The page just renders. | Should warn the user if they have business income — push to ITR-3 | No banner at all; no wizard cross-check |
| **ITR-2 TDS scope** | Reports only salary TDS from `salary_income`. Banner pulls non-salary TDS but the form itself doesn't | All TDS sections valid (ITR-2 is generic) | Acceptable but not visible on the form summary itself |
| **ITR-3 includes** | Salary + Schedule BP from GST invoices (44ADA presumptive @ 50%) + CG + OS + Section-80 + non-salary TDS + advance tax | Salary + business/profession + any HP + CG + OS + foreign income | HP not surfaced at all on the ITR-3 page (relies on user filling Excel directly) — acceptable for now since ITR-3 hub is export-focused |
| **ITR-3 excludes** | Nothing — ITR-3 is the catch-all | Nothing | None — correct |
| **ITR-3 eligibility warning** | None. Always lets user proceed | Always eligible — should render a green "Eligible for ITR-3" badge | Cosmetic gap: user doesn't know they're in the right place |
| **ITR-3 TDS scope** | Salary + non-salary TDS from `tds_credits` (all sections) | Same | Correct |
| **ITR-4 includes** | Salary + `presumptive_income` rows (44AD/ADA/AE) + non-exempt `other_sources_income` + Section-80 deductions | Salary + ONE HP + presumptive + OS, total ≤ ₹50L | HP not surfaced at all. Multi-property/CG/foreign/director/agri checks missing |
| **ITR-4 excludes** | CG (silently), additional HPs (silently — doesn't even read `real_estate`), foreign income, director / unlisted | Same | All exclusions silent. Wizard cross-check missing |
| **ITR-4 eligibility warning** | `exceedsCap` only (total > ₹50L or 44AD receipts > ₹2cr); footer paragraph on per-section rules | Each ineligibility flag should surface (CG, multi-HP, foreign, director, agri) | Identical gap to ITR-1 — only the cap is shown |
| **ITR-4 TDS scope** | Salary TDS only. `tds_credits` ignored | Same scope as ITR-1 (limited) | Non-salary TDS silent |

## Cross-cutting findings

1. **Wizard recommendation is invisible.** Despite `itr_form_selection` persisting the wizard's pick, neither ITR-1 nor ITR-4 surface the mismatch. A user can land on the wrong form (deep link, sidebar bookmark, switch-form CTA from elsewhere) and see numbers that look correct but silently drop ₹7-10L of income.
2. **No data-driven ineligibility surfacing.** The forms encode their rules in prose footers and a binary `exceedsCap`. The user has CG data in the DB but ITR-1 won't tell them so. The user has multi-property data but ITR-4 doesn't even read `real_estate`.
3. **ITR-1 first-row HP is data hiding.** The endpoint picks `realEstate` ordered by `id` ASC limit 1. That happens to be Anand (self-occupied) for BXDEva, so it shows ₹0 rent and the user can't see Whitefield rent at all on the ITR-1 page.
4. **ITR-2 should call out business income.** BXDEva has no invoices, but if they did, the page would silently ignore them. ITR-2 must push to ITR-3 in that case.
5. **Stubs are acceptable** for foreign income / director-of-company / agricultural > ₹5k since none of those are captured in the schema today. They should still be typed correctly in the response shape so the UI never renders a false-negative warning.

## Sprint 5.4 fix shape (Phases B–D)

- **Phase B** — single `ItrEligibilityBanner` component reused on all four pages.
- **Phase C** — each summary endpoint extends its response with `eligibility.flags`, `excludedIncomeBlocks`, `wizardSelectedForm`. ITR-1 additionally returns `housePropertyRows` so the page can render every property even though only one is "in scope".
- **Phase D** — pages mount the banner above the result banner, ITR-1 rewords "Total income" → "ITR-1 eligible income" + shows actual total below it, ITR-1 HP section lists all rows when > 1.
