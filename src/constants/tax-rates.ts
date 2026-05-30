export const TAX_RATES = [0, 5, 12, 18, 28] as const;
export type TaxRate = (typeof TAX_RATES)[number];

export const TAX_RATE_OPTIONS = TAX_RATES.map((rate) => ({
  value: rate.toString(),
  label: `${rate}%`,
}));

export function isValidTaxRate(rate: number): rate is TaxRate {
  return TAX_RATES.includes(rate as TaxRate);
}
