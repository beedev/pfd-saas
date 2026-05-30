/**
 * Amount parsing and formatting utilities for financial data.
 * All internal values are stored in paisa (1 rupee = 100 paisa).
 */

/**
 * Parse user input into paisa.
 * Accepts various formats:
 * - "36" or "36000" → 3600000 paisa (₹36,000)
 * - "36K" or "36k" → 3600000 paisa (₹36,000)
 * - "3.6L" or "3.6l" → 36000000 paisa (₹3,60,000)
 * - "1Cr" or "1cr" → 10000000000 paisa (₹1,00,00,000)
 * - "-36K" → -3600000 paisa (negative values)
 * - Empty/null → 0
 */
export function parseAmount(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') {
    return 0;
  }

  // If already a number, assume it's in rupees and convert to paisa
  if (typeof input === 'number') {
    return Math.round(input * 100);
  }

  const str = input.toString().trim().toLowerCase();

  if (str === '' || str === '-') {
    return 0;
  }

  // Check for negative
  const isNegative = str.startsWith('-');
  const cleanStr = isNegative ? str.slice(1) : str;

  // Extract number and suffix
  const match = cleanStr.match(/^([\d,.]+)\s*(k|l|lakh|lakhs|cr|crore|crores)?$/i);

  if (!match) {
    // Try parsing as plain number
    const num = parseFloat(cleanStr.replace(/,/g, ''));
    if (isNaN(num)) return 0;
    // Assume plain numbers without suffix are in rupees
    return Math.round((isNegative ? -num : num) * 100);
  }

  const [, numStr, suffix] = match;
  const num = parseFloat(numStr.replace(/,/g, ''));

  if (isNaN(num)) return 0;

  let multiplier = 1;

  switch (suffix?.toLowerCase()) {
    case 'k':
      multiplier = 1000;
      break;
    case 'l':
    case 'lakh':
    case 'lakhs':
      multiplier = 100000;
      break;
    case 'cr':
    case 'crore':
    case 'crores':
      multiplier = 10000000;
      break;
    default:
      multiplier = 1;
  }

  const rupees = num * multiplier;
  const paisa = Math.round(rupees * 100);

  return isNegative ? -paisa : paisa;
}

/**
 * Format paisa as compact string for display in grid cells.
 * Uses K for thousands, L for lakhs, Cr for crores.
 * Examples:
 * - 3600000 → "36K"
 * - 36000000 → "3.6L"
 * - 100000000 → "10L"
 * - 10000000000 → "1Cr"
 * - 0 → "-" (dash for empty)
 */
export function formatCompact(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined || paisa === 0) {
    return '-';
  }

  const isNegative = paisa < 0;
  const absPaisa = Math.abs(paisa);
  const rupees = absPaisa / 100;

  let formatted: string;

  if (rupees >= 10000000) {
    // Crores (≥1Cr)
    const cr = rupees / 10000000;
    formatted = cr % 1 === 0 ? `${cr}Cr` : `${cr.toFixed(1)}Cr`;
  } else if (rupees >= 100000) {
    // Lakhs (≥1L)
    const l = rupees / 100000;
    formatted = l % 1 === 0 ? `${l}L` : `${l.toFixed(1)}L`;
  } else if (rupees >= 1000) {
    // Thousands (≥1K)
    const k = rupees / 1000;
    formatted = k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
  } else {
    // Less than 1K, show as is
    formatted = rupees % 1 === 0 ? `${rupees}` : rupees.toFixed(0);
  }

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Format paisa as full currency string for display.
 * Example: 3600000 → "₹36,000"
 */
export function formatCurrency(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined) {
    return '₹0';
  }

  const rupees = paisa / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
}

/**
 * Format paisa as number string without currency symbol.
 * Example: 3600000 → "36,000"
 */
export function formatNumber(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined) {
    return '0';
  }

  const rupees = paisa / 100;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
}

/**
 * Convert rupees to paisa.
 */
export function rupeesToPaisa(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Convert paisa to rupees.
 */
export function paisaToRupees(paisa: number): number {
  return paisa / 100;
}

/**
 * Generate an array of periods (MMYYYY) for a date range.
 */
export function generatePeriods(startDate: Date, months: number): string[] {
  const periods: string[] = [];
  const current = new Date(startDate);

  for (let i = 0; i < months; i++) {
    const month = (current.getMonth() + 1).toString().padStart(2, '0');
    const year = current.getFullYear().toString();
    periods.push(`${month}${year}`);
    current.setMonth(current.getMonth() + 1);
  }

  return periods;
}

/**
 * Parse period (MMYYYY) to Date.
 */
export function parsePeriod(period: string): Date | null {
  if (!period || period.length !== 6) return null;
  const month = parseInt(period.substring(0, 2), 10) - 1;
  const year = parseInt(period.substring(2, 6), 10);
  if (isNaN(month) || isNaN(year)) return null;
  return new Date(year, month, 1);
}

/**
 * Format period (MMYYYY) for display.
 * Example: "102025" → "Oct 2025"
 */
export function formatPeriodShort(period: string): string {
  const date = parsePeriod(period);
  if (!date) return period;
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/**
 * Format period (MMYYYY) for full display.
 * Example: "102025" → "October 2025"
 */
export function formatPeriodFull(period: string): string {
  const date = parsePeriod(period);
  if (!date) return period;
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/**
 * Get current period in MMYYYY format.
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear().toString();
  return `${month}${year}`;
}

/**
 * Add months to a period.
 */
export function addMonthsToPeriod(period: string, months: number): string {
  const date = parsePeriod(period);
  if (!date) return period;
  date.setMonth(date.getMonth() + months);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear().toString();
  return `${month}${year}`;
}
