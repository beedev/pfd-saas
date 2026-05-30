import { TaxRate, TAX_RATES, isValidTaxRate } from '@/constants/tax-rates';

export interface TaxCalculationInput {
  taxableAmountPaisa: number;
  taxRate: TaxRate;
  isInterState: boolean;
}

export interface TaxCalculationResult {
  taxableAmount: number;     // In paisa
  cgstRate: number;
  cgstAmount: number;        // In paisa
  sgstRate: number;
  sgstAmount: number;        // In paisa
  igstRate: number;
  igstAmount: number;        // In paisa
  totalTax: number;          // In paisa
  totalAmount: number;       // In paisa
}

/**
 * Calculate tax amounts based on taxable value, rate, and inter-state flag
 */
export function calculateTax(input: TaxCalculationInput): TaxCalculationResult {
  const { taxableAmountPaisa, taxRate, isInterState } = input;

  if (isInterState) {
    // Inter-state: IGST = Full rate
    const igstAmount = Math.round(taxableAmountPaisa * taxRate / 100);
    return {
      taxableAmount: taxableAmountPaisa,
      cgstRate: 0,
      cgstAmount: 0,
      sgstRate: 0,
      sgstAmount: 0,
      igstRate: taxRate,
      igstAmount,
      totalTax: igstAmount,
      totalAmount: taxableAmountPaisa + igstAmount,
    };
  } else {
    // Intra-state: CGST + SGST = Half rate each
    const halfRate = taxRate / 2;
    const cgstAmount = Math.round(taxableAmountPaisa * halfRate / 100);
    const sgstAmount = Math.round(taxableAmountPaisa * halfRate / 100);
    return {
      taxableAmount: taxableAmountPaisa,
      cgstRate: halfRate,
      cgstAmount,
      sgstRate: halfRate,
      sgstAmount,
      igstRate: 0,
      igstAmount: 0,
      totalTax: cgstAmount + sgstAmount,
      totalAmount: taxableAmountPaisa + cgstAmount + sgstAmount,
    };
  }
}

/**
 * Determine if a supply is inter-state based on supplier and place of supply state codes
 */
export function determineIsInterState(
  supplierStateCode: string,
  placeOfSupplyCode: string
): boolean {
  return supplierStateCode !== placeOfSupplyCode;
}

/**
 * Convert rupees to paisa
 */
export function rupeesToPaisa(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Convert paisa to rupees
 */
export function paisaToRupees(paisa: number): number {
  return paisa / 100;
}

/**
 * Format amount in rupees with proper decimal places
 */
export function formatRupees(paisa: number): string {
  const rupees = paisaToRupees(paisa);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Format amount without currency symbol
 */
export function formatAmount(paisa: number): string {
  const rupees = paisaToRupees(paisa);
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Calculate total tax for an invoice with multiple line items
 */
export interface InvoiceLineItem {
  taxableAmountPaisa: number;
  taxRate: TaxRate;
}

export interface InvoiceTaxSummary {
  totalTaxableAmount: number;  // In paisa
  totalCGST: number;           // In paisa
  totalSGST: number;           // In paisa
  totalIGST: number;           // In paisa
  totalTax: number;            // In paisa
  totalAmount: number;         // In paisa
}

export function calculateInvoiceTax(
  lineItems: InvoiceLineItem[],
  isInterState: boolean
): InvoiceTaxSummary {
  let totalTaxableAmount = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;

  for (const item of lineItems) {
    const taxResult = calculateTax({
      taxableAmountPaisa: item.taxableAmountPaisa,
      taxRate: item.taxRate,
      isInterState,
    });

    totalTaxableAmount += taxResult.taxableAmount;
    totalCGST += taxResult.cgstAmount;
    totalSGST += taxResult.sgstAmount;
    totalIGST += taxResult.igstAmount;
  }

  const totalTax = totalCGST + totalSGST + totalIGST;

  return {
    totalTaxableAmount,
    totalCGST,
    totalSGST,
    totalIGST,
    totalTax,
    totalAmount: totalTaxableAmount + totalTax,
  };
}

/**
 * ITC Set-off calculation
 * Priority order for using ITC:
 * 1. IGST ITC: Can be used to pay IGST first, then CGST, then SGST
 * 2. CGST ITC: Can be used to pay CGST only
 * 3. SGST ITC: Can be used to pay SGST only
 */
export interface ITCSetOffInput {
  cgstLiability: number;
  sgstLiability: number;
  igstLiability: number;
  cgstITC: number;
  sgstITC: number;
  igstITC: number;
}

export interface ITCSetOffResult {
  // ITC utilized
  igstItcForIgst: number;
  igstItcForCgst: number;
  igstItcForSgst: number;
  cgstItcForCgst: number;
  sgstItcForSgst: number;

  // Remaining ITC
  remainingCgstITC: number;
  remainingSgstITC: number;
  remainingIgstITC: number;

  // Cash payable
  cgstCashPayable: number;
  sgstCashPayable: number;
  igstCashPayable: number;
  totalCashPayable: number;
}

export function calculateITCSetOff(input: ITCSetOffInput): ITCSetOffResult {
  let { cgstLiability, sgstLiability, igstLiability, cgstITC, sgstITC, igstITC } = input;

  // Step 1: Use IGST ITC to pay IGST liability
  const igstItcForIgst = Math.min(igstITC, igstLiability);
  igstITC -= igstItcForIgst;
  igstLiability -= igstItcForIgst;

  // Step 2: Use remaining IGST ITC to pay CGST liability
  const igstItcForCgst = Math.min(igstITC, cgstLiability);
  igstITC -= igstItcForCgst;
  cgstLiability -= igstItcForCgst;

  // Step 3: Use remaining IGST ITC to pay SGST liability
  const igstItcForSgst = Math.min(igstITC, sgstLiability);
  igstITC -= igstItcForSgst;
  sgstLiability -= igstItcForSgst;

  // Step 4: Use CGST ITC to pay remaining CGST liability
  const cgstItcForCgst = Math.min(cgstITC, cgstLiability);
  cgstITC -= cgstItcForCgst;
  cgstLiability -= cgstItcForCgst;

  // Step 5: Use SGST ITC to pay remaining SGST liability
  const sgstItcForSgst = Math.min(sgstITC, sgstLiability);
  sgstITC -= sgstItcForSgst;
  sgstLiability -= sgstItcForSgst;

  return {
    igstItcForIgst,
    igstItcForCgst,
    igstItcForSgst,
    cgstItcForCgst,
    sgstItcForSgst,
    remainingCgstITC: cgstITC,
    remainingSgstITC: sgstITC,
    remainingIgstITC: igstITC,
    cgstCashPayable: cgstLiability,
    sgstCashPayable: sgstLiability,
    igstCashPayable: igstLiability,
    totalCashPayable: cgstLiability + sgstLiability + igstLiability,
  };
}

/**
 * Get current return period in MMYYYY format
 */
export function getCurrentReturnPeriod(): string {
  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear().toString();
  return `${month}${year}`;
}

/**
 * Get return period for a date in MMYYYY format
 */
export function getReturnPeriod(date: Date): string {
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear().toString();
  return `${month}${year}`;
}

/**
 * Parse return period MMYYYY to Date
 */
export function parseReturnPeriod(period: string): Date | null {
  if (!period || period.length !== 6) return null;
  const month = parseInt(period.substring(0, 2), 10) - 1;
  const year = parseInt(period.substring(2, 6), 10);
  if (isNaN(month) || isNaN(year)) return null;
  return new Date(year, month, 1);
}

/**
 * Format return period for display (e.g., "December 2024")
 */
export function formatReturnPeriod(period: string): string {
  const date = parseReturnPeriod(period);
  if (!date) return period;
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export { TAX_RATES, isValidTaxRate };
export type { TaxRate };
