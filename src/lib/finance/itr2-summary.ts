/**
 * ITR-2 summary computation — Sprint 4.1.
 *
 * Salary + multi-house-property + capital gains + other sources.
 * No business income (that's ITR-3 territory).
 *
 * Tax is the sum of:
 *   • Slab tax on (salary + house-property + other + STCG-non-111A).
 *     The STCG-non-111A is added to slab gross because it's taxed at
 *     the user's marginal rate.
 *   • Capital-gains tax computed separately (STCG sec 111A flat 15%,
 *     LTCG sec 112A 10% on equity gains over ₹1L, LTCG-other flat 20%).
 *
 * Two cess applications, separately:
 *   • 4% on (slab tax − 87A rebate) — handled inside computeTax()
 *   • 4% on capital-gains tax — handled inside computeCapitalGainsTax()
 * Adding cess to both halves separately avoids double-counting; both
 * are statutory cess applications on different tax heads.
 *
 * The 87A rebate is intentionally NOT applied to capital-gains tax.
 * Sec 87A rebates slab tax; LTCG/STCG-111A are taxed at fixed rates
 * and don't qualify (current settled position post-2023 amendment).
 *
 * Deferred (see CLAUDE.md):
 *   • Cost-inflation-index lookup for LTCG-other → flat 20% used now
 *   • Schedule FA (foreign assets) capture
 *   • Carry-forward of capital losses
 */

import { computeTax, type TaxSlabRow, type TaxRegimeConfigRow } from './tax-slabs';
import {
  computeCapitalGainsTax,
  type CapitalGainRow,
  type CapitalGainsTaxBreakdown,
} from './capital-gains-tax';
import type { Itr1SinglePropertyInput } from './itr1-summary';

/** Each house property row mirrors the Itr1SinglePropertyInput shape,
 *  but ITR-2 accepts many of them. */
export type Itr2HousePropertyInput = Itr1SinglePropertyInput & {
  /** Friendly name for surfacing per-row in UI. Not used in math. */
  label?: string;
};

export interface Itr2SummaryInput {
  salaryGrossPaisa: number;
  salaryExemptionsPaisa: number;
  /** All house properties — may be 0, 1, or many. */
  houseProperties: Itr2HousePropertyInput[];
  /** Other-sources income (interest + dividends). */
  otherIncomePaisa: number;
  /** Realised capital-gains rows for the FY. */
  capitalGainsRows: CapitalGainRow[];
  /** Section-80 deductions (regime-eligible total). */
  deductionsPaisa: number;
  slabs: TaxSlabRow[];
  config: TaxRegimeConfigRow;
  regime: 'OLD' | 'NEW';
  /** FY identifier — passed to capital-gains lib for future
   *  FY-dependent rate branching. */
  fy: string;
}

export interface Itr2SummaryResult {
  salaryIncomePaisa: number;
  /** Net house-property income summed across rows (can be negative
   *  when self-occupied with home-loan interest exceeds rent). */
  housePropertyIncomePaisa: number;
  /** Per-row breakdown for surfacing the multi-house table. */
  housePropertyRows: Array<{
    label: string;
    gavPaisa: number;
    municipalTaxesPaisa: number;
    navPaisa: number;
    stdMaintenancePaisa: number;
    interestPaisa: number;
    netIncomePaisa: number;
  }>;
  otherSourcesPaisa: number;
  /** Capital-gains breakdown including the flat-rate tax components. */
  capitalGains: CapitalGainsTaxBreakdown;
  /** Slab-eligible gross — what feeds the slab calculation. Includes
   *  salary + house property + other-sources + STCG-non-111A. */
  slabGrossIncomePaisa: number;
  taxableIncomePaisa: number;
  slabTaxPaisa: number;
  rebatePaisa: number;
  taxAfterRebatePaisa: number;
  /** Cess on slab portion only. CG cess is inside capitalGains. */
  slabCessPaisa: number;
  /** Slab-portion total (slab tax − rebate + cess). */
  slabComponentPaisa: number;
  /** Capital-gains-tax + its cess. */
  capitalGainsComponentPaisa: number;
  /** Final total tax owed. */
  totalTaxPaisa: number;
  /** Effective rate vs (slab gross + capital-gains gains pre-tax). */
  effectiveRatePct: number;
  regime: 'OLD' | 'NEW';
}

function computeHousePropertyRow(p: Itr2HousePropertyInput) {
  const gav = p.annualRentPaisa;
  const nav = Math.max(0, gav - p.municipalTaxesPaisa);
  const stdMaintenance = Math.round(nav * 0.30);
  const netIncome = nav - stdMaintenance - p.homeLoanInterestPaisa;
  return {
    label: p.label ?? 'Property',
    gavPaisa: gav,
    municipalTaxesPaisa: p.municipalTaxesPaisa,
    navPaisa: nav,
    stdMaintenancePaisa: stdMaintenance,
    interestPaisa: p.homeLoanInterestPaisa,
    netIncomePaisa: netIncome,
  };
}

export function computeItr2Summary(input: Itr2SummaryInput): Itr2SummaryResult {
  const salaryIncome = Math.max(
    0,
    input.salaryGrossPaisa - input.salaryExemptionsPaisa,
  );

  const hpRows = input.houseProperties.map(computeHousePropertyRow);
  const housePropertyIncome = hpRows.reduce(
    (s, r) => s + r.netIncomePaisa,
    0,
  );

  // Capital gains computed first — we need stcgOtherAddsToSlabPaisa
  // to fold into slab gross before the slab calc.
  const cg = computeCapitalGainsTax({
    gainsRows: input.capitalGainsRows,
    fy: input.fy,
  });

  // Slab-gross = salary + HP + other + STCG-non-111A.
  // Note: HP income can be negative (loss); slab gross can dip below
  // 0 — computeTax already floors to 0, so passthrough is safe.
  const slabGross =
    salaryIncome +
    housePropertyIncome +
    input.otherIncomePaisa +
    cg.stcgOtherAddsToSlabPaisa;

  const slabTax = computeTax({
    grossIncomePaisa: Math.max(0, slabGross),
    deductionsPaisa: input.deductionsPaisa,
    slabs: input.slabs,
    config: input.config,
  });

  const slabComponent = slabTax.totalTaxPaisa;
  const capitalGainsComponent =
    cg.totalCapitalGainsTaxPaisa + cg.cessPaisa;
  const totalTax = slabComponent + capitalGainsComponent;

  // Effective rate vs total realised gross — used for the headline.
  const realisedGross =
    salaryIncome +
    Math.max(0, housePropertyIncome) +
    input.otherIncomePaisa +
    cg.buckets.stcgEquityGainsPaisa +
    cg.buckets.stcgOtherGainsPaisa +
    cg.buckets.ltcgEquityGainsPaisa +
    cg.buckets.ltcgOtherGainsPaisa;
  const effectiveRatePct =
    realisedGross > 0 ? (totalTax / realisedGross) * 100 : 0;

  return {
    salaryIncomePaisa: salaryIncome,
    housePropertyIncomePaisa: housePropertyIncome,
    housePropertyRows: hpRows,
    otherSourcesPaisa: input.otherIncomePaisa,
    capitalGains: cg,
    slabGrossIncomePaisa: Math.max(0, slabGross),
    taxableIncomePaisa: slabTax.taxablePaisa,
    slabTaxPaisa: slabTax.taxBeforeRebatePaisa,
    rebatePaisa: slabTax.rebatePaisa,
    taxAfterRebatePaisa: slabTax.taxAfterRebatePaisa,
    slabCessPaisa: slabTax.cessPaisa,
    slabComponentPaisa: slabComponent,
    capitalGainsComponentPaisa: capitalGainsComponent,
    totalTaxPaisa: totalTax,
    effectiveRatePct,
    regime: input.regime,
  };
}
