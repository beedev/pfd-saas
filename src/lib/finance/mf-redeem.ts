/**
 * MF redemption math (average-cost).
 *
 * Given a holding and a redemption (units OR amount) settled at a known
 * NAV on a known date, computes the proceeds, the average-cost basis of
 * the units sold, the realized gain, and the LTCG/STCG classification
 * from a units-weighted acquisition date derived from the buy history.
 *
 * Average-cost (the holding model has no purchase lots) — so the
 * holding-period classification is an approximation: the whole
 * redemption is LT or ST by the weighted-average acquisition date, not
 * split across the threshold. Exact per-lot FIFO is a future upgrade.
 */

import type { MutualFund, MutualFundType, CapGainAssetType, HoldingPeriod } from '@/db';

export interface BuyLeg {
  /** units acquired in this buy/SIP transaction */
  quantity: number;
  /** ISO date of the acquisition */
  transactionDate: string;
}

export interface RedemptionComputation {
  navPaisa: number;
  unitsSold: number;
  proceedsPaisa: number;
  costBasisPaisa: number;
  realizedGainPaisa: number;
  acquisitionDate: string | null;
  holdingPeriod: HoldingPeriod;
  assetType: CapGainAssetType;
  financialYear: string;
}

const DAY_MS = 86_400_000;

/** Indian FY (YYYY-YY) containing an ISO date (Apr–Mar). */
export function fyForIso(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Map fund type → capital-gains asset type. */
export function cgAssetTypeFor(fundType: MutualFundType): CapGainAssetType {
  switch (fundType) {
    case 'EQUITY':
    case 'HYBRID': // equity-oriented hybrids taxed as equity; approximated
      return 'EQUITY_MF';
    case 'DEBT':
    case 'LIQUID':
      return 'DEBT_MF';
    case 'GOLD':
      return 'GOLD';
    default:
      return 'OTHER';
  }
}

/** Units-weighted average acquisition date from the buy legs. */
export function weightedAcquisitionDate(buys: BuyLeg[]): string | null {
  const legs = buys.filter((b) => b.quantity > 0 && b.transactionDate);
  if (legs.length === 0) return null;
  let wSum = 0;
  let wTime = 0;
  for (const b of legs) {
    const t = new Date(b.transactionDate + 'T00:00:00Z').getTime();
    if (!Number.isFinite(t)) continue;
    wSum += b.quantity;
    wTime += b.quantity * t;
  }
  if (wSum === 0) return null;
  return new Date(wTime / wSum).toISOString().slice(0, 10);
}

/**
 * LTCG/STCG by asset type + holding span. Equity: >12 months = LTCG.
 * Debt/liquid (post-FY2023-24): always STCG (slab). Gold/other: >24
 * months = LTCG.
 */
export function classifyHolding(
  assetType: CapGainAssetType,
  acquisitionDate: string | null,
  saleDate: string,
): HoldingPeriod {
  if (assetType === 'DEBT_MF') return 'STCG';
  if (!acquisitionDate) return 'STCG'; // conservative when unknown
  const days = (new Date(saleDate + 'T00:00:00Z').getTime() - new Date(acquisitionDate + 'T00:00:00Z').getTime()) / DAY_MS;
  const ltThresholdDays = assetType === 'EQUITY_MF' ? 365 : 365 * 2;
  return days > ltThresholdDays ? 'LTCG' : 'STCG';
}

/**
 * Compute a redemption settlement.
 * @param navRupees applicable NAV (rupees per unit)
 * @param mode 'units' → `value` is units to redeem; 'amount' → `value` is rupees
 */
export function computeRedemption(opts: {
  mf: Pick<MutualFund, 'units' | 'totalInvestment' | 'fundType'>;
  mode: 'units' | 'amount';
  value: number;
  navRupees: number;
  saleDate: string;
  buys: BuyLeg[];
  /** User-chosen tax type captured at redeem time — wins over auto-detection. */
  holdingPeriodOverride?: HoldingPeriod | null;
  /** Acquisition date to fall back on when there's no buy history (lump-sum:
   *  the fund's investment_start_date). Ignored when buy legs exist. */
  fallbackAcquisitionDate?: string | null;
  /** Tax type to assume when neither buy history nor a fallback date is usable
   *  (e.g. a SIP with no recorded installments). Defaults to LTCG. */
  defaultHoldingPeriod?: HoldingPeriod;
}): RedemptionComputation {
  const {
    mf, mode, value, navRupees, saleDate, buys,
    holdingPeriodOverride, fallbackAcquisitionDate, defaultHoldingPeriod = 'LTCG',
  } = opts;
  const navPaisa = Math.round(navRupees * 100);

  const unitsSold = mode === 'units' ? value : value / navRupees;
  const proceedsPaisa =
    mode === 'amount' ? Math.round(value * 100) : Math.round(unitsSold * navRupees * 100);

  // Average-cost basis of the units sold (proportional slice of the
  // holding's total invested).
  const costBasisPaisa =
    mf.units > 0 ? Math.round((mf.totalInvestment * unitsSold) / mf.units) : 0;
  const realizedGainPaisa = proceedsPaisa - costBasisPaisa;

  const assetType = cgAssetTypeFor(mf.fundType);
  // Acquisition date: buy history (most precise) → lump-sum fallback date.
  const acquisitionDate = weightedAcquisitionDate(buys) ?? fallbackAcquisitionDate ?? null;
  // Holding period precedence: explicit user override → date-based → default.
  const holdingPeriod: HoldingPeriod =
    holdingPeriodOverride ??
    (acquisitionDate
      ? classifyHolding(assetType, acquisitionDate, saleDate)
      : defaultHoldingPeriod);

  return {
    navPaisa,
    unitsSold,
    proceedsPaisa,
    costBasisPaisa,
    realizedGainPaisa,
    acquisitionDate,
    holdingPeriod,
    assetType,
    financialYear: fyForIso(saleDate),
  };
}
