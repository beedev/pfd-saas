/**
 * Sprint 6.2b — Section 80 deductions report data fetcher.
 *
 * Pulls user-claimed tax_deductions for the FY, groups them by section,
 * and surfaces the SECTION_CAPS metadata so the report can show
 * "Claimed ₹X of ₹Y cap (Z% used)" per section.
 *
 * We don't reimplement the rich /api/tax/summary aggregator (which
 * fans out across mutual_funds, insurance, NPS, etc. to auto-detect
 * deductions). The report intentionally focuses on the *claimed*
 * deductions the user has confirmed — that's what an ITR filer needs
 * to substantiate. The auto-detected hints live in the dashboard
 * card, not in this print-ready report.
 */

import { and, eq } from 'drizzle-orm';
import { db, taxDeductions } from '@/db';
import {
  SECTION_CAPS,
  type TaxSection,
  getCurrentFinancialYear,
} from '@/lib/finance/tax-constants';
import type { ReportParams } from '@/types/reports';

export interface Section80Deduction {
  section: string;
  description: string;
  recipient: string;
  amountPaisa: number;
  paymentDate: string;
  paymentMethod: string;
  pan: string;
  notes: string;
}

export interface Section80Row {
  section: string;
  label: string;
  description: string;
  capPaisa: number | null;
  claimedPaisa: number;
  cappedPaisa: number;
  usedPct: number;
  entries: Section80Deduction[];
}

export interface Section80ReportData {
  fy: string;
  regime: 'OLD' | 'NEW';
  rows: Section80Row[];
  totals: {
    claimedPaisa: number;
    cappedPaisa: number;
  };
}

/** Normalise legacy SECTION_80C → 80C, and 80CCD → 80CCD_1B. Mirrors
 *  the conversion in /api/tax/summary so the two stay aligned. */
function normaliseSection(s: string | null): string {
  if (!s) return 'UNKNOWN';
  let sec = s;
  if (sec.startsWith('SECTION_')) sec = sec.replace('SECTION_', '');
  if (sec === '80CCD') sec = '80CCD_1B';
  return sec;
}

export async function fetchSection80(params: ReportParams): Promise<Section80ReportData> {
  const userId = params.userId;
  const fy = params.fy || getCurrentFinancialYear();

  const deductions = await db
    .select()
    .from(taxDeductions)
    .where(and(eq(taxDeductions.userId, userId), eq(taxDeductions.financialYear, fy)));

  // Build buckets keyed by section.
  const buckets = new Map<string, Section80Row>();
  for (const s of Object.keys(SECTION_CAPS) as TaxSection[]) {
    const meta = SECTION_CAPS[s];
    buckets.set(s, {
      section: s,
      label: meta.label,
      description: meta.description,
      capPaisa: meta.capPaisa,
      claimedPaisa: 0,
      cappedPaisa: 0,
      usedPct: 0,
      entries: [],
    });
  }

  for (const d of deductions) {
    const sec = normaliseSection(d.section);
    let bucket = buckets.get(sec);
    if (!bucket) {
      bucket = {
        section: sec,
        label: sec,
        description: '',
        capPaisa: null,
        claimedPaisa: 0,
        cappedPaisa: 0,
        usedPct: 0,
        entries: [],
      };
      buckets.set(sec, bucket);
    }
    const amt = d.amountPaisa || d.deductibleAmount || 0;
    bucket.claimedPaisa += amt;
    bucket.entries.push({
      section: sec,
      description: d.description || '',
      recipient: d.recipientName || '',
      amountPaisa: amt,
      paymentDate: d.paymentDate || d.incurredDate || '',
      paymentMethod: d.paymentMethod || '',
      pan: d.recipientPan || '',
      notes: d.notes || '',
    });
  }

  // Apply caps + percentages.
  let totalClaimed = 0;
  let totalCapped = 0;
  for (const bucket of buckets.values()) {
    bucket.cappedPaisa =
      bucket.capPaisa != null ? Math.min(bucket.claimedPaisa, bucket.capPaisa) : bucket.claimedPaisa;
    bucket.usedPct =
      bucket.capPaisa && bucket.capPaisa > 0
        ? Math.min(100, (bucket.claimedPaisa / bucket.capPaisa) * 100)
        : 0;
    totalClaimed += bucket.claimedPaisa;
    totalCapped += bucket.cappedPaisa;
  }

  // Only surface sections that have entries — keeps the report tight.
  const rows = [...buckets.values()].filter((b) => b.entries.length > 0);

  return {
    fy,
    regime: 'OLD', // report intentionally focuses on the regime where Section 80 matters
    rows,
    totals: {
      claimedPaisa: totalClaimed,
      cappedPaisa: totalCapped,
    },
  };
}
