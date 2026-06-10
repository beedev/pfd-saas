/**
 * Sprint 6.2f — Dynamic report dispatch.
 *
 * GET /api/reports/{id}/{format}?fy=2025-26
 *
 * Single route handles every (reportId × format) combination declared
 * in the REPORTS registry. The handler:
 *
 *   1. Authenticates (multi-tenant gate).
 *   2. Looks up the descriptor — 404 if unknown id.
 *   3. Validates the requested format is in `descriptor.formats` — 400 otherwise.
 *   4. Reads `fy` from the query string (defaults to current FY for
 *      FY-scoped reports).
 *   5. Dispatches to the matching fetcher + generator.
 *   6. Returns the buffer with the correct Content-Type and an
 *      attachment Content-Disposition.
 *
 * `runtime = 'nodejs'` is required: @react-pdf/renderer relies on
 * Node-only APIs (Buffer + stream); the default edge runtime would
 * throw at the first react-pdf import.
 *
 * The `filing-pack` report is a thin redirect to the existing
 * /api/tax/filing-pack/generate ZIP endpoint — we don't reimplement
 * its logic, only expose it through the new registry-driven URL so
 * the hub UI can link it like any other report.
 */

import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import type { DocumentProps } from '@react-pdf/renderer';
import { renderToBuffer } from '@react-pdf/renderer';
import { auth } from '@/auth';
import { getReport } from '@/lib/reports';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { safeFilename } from '@/lib/reports/format-utils';

// Fetchers
import { fetchNetWorth } from '@/lib/reports/data/fetchNetWorth';
import { fetchIncomeSummary } from '@/lib/reports/data/fetchIncomeSummary';
import { fetchSection80 } from '@/lib/reports/data/fetchSection80';
import { fetchCapitalGains } from '@/lib/reports/data/fetchCapitalGains';
import { fetchForm80g } from '@/lib/reports/data/fetchForm80g';
import { fetchForm26asRecon } from '@/lib/reports/data/fetchForm26asRecon';
import { fetchRetirementProjection } from '@/lib/reports/data/fetchRetirementProjection';
import { fetchCashflow } from '@/lib/reports/data/fetchCashflow';

// PDFs
import { NetWorthPdf } from '@/lib/reports/pdf/NetWorthPdf';
import { IncomeSummaryPdf } from '@/lib/reports/pdf/IncomeSummaryPdf';
import { Section80Pdf } from '@/lib/reports/pdf/Section80Pdf';
import { CapitalGainsPdf } from '@/lib/reports/pdf/CapitalGainsPdf';
import { Form80gPdf } from '@/lib/reports/pdf/Form80gPdf';
import { Form26asReconPdf } from '@/lib/reports/pdf/Form26asReconPdf';
import { RetirementPdf } from '@/lib/reports/pdf/RetirementPdf';
import { CashflowPdf } from '@/lib/reports/pdf/CashflowPdf';

// Excel
import { buildNetWorthXlsx } from '@/lib/reports/excel/NetWorthXlsx';
import { buildIncomeSummaryXlsx } from '@/lib/reports/excel/IncomeSummaryXlsx';
import { buildSection80Xlsx } from '@/lib/reports/excel/Section80Xlsx';
import { buildCapitalGainsXlsx } from '@/lib/reports/excel/CapitalGainsXlsx';
import { buildForm80gXlsx } from '@/lib/reports/excel/Form80gXlsx';
import { buildRetirementXlsx } from '@/lib/reports/excel/RetirementXlsx';
import { buildCashflowXlsx } from '@/lib/reports/excel/CashflowXlsx';

// CSV
import { buildNetWorthCsv } from '@/lib/reports/csv/NetWorthCsv';
import { buildIncomeSummaryCsv } from '@/lib/reports/csv/IncomeSummaryCsv';
import { buildSection80Csv } from '@/lib/reports/csv/Section80Csv';
import { buildCapitalGainsCsv } from '@/lib/reports/csv/CapitalGainsCsv';
import { buildForm26asReconCsv } from '@/lib/reports/csv/Form26asReconCsv';
import { buildCashflowCsv } from '@/lib/reports/csv/CashflowCsv';

export const runtime = 'nodejs';

const MIME_PDF = 'application/pdf';
const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_CSV = 'text/csv; charset=utf-8';

function attach(filename: string): string {
  return `attachment; filename="${filename}"`;
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; format: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { id, format } = await ctx.params;
  const descriptor = getReport(id);
  if (!descriptor) {
    return NextResponse.json({ error: `Unknown report: ${id}` }, { status: 404 });
  }
  if (!descriptor.formats.includes(format as 'pdf' | 'xlsx' | 'csv' | 'zip')) {
    return NextResponse.json(
      { error: `Format ${format} not supported for ${id}` },
      { status: 400 },
    );
  }

  const userId = session.user.id;
  const fy =
    new URL(request.url).searchParams.get('fy') ||
    (descriptor.needsFy ? getCurrentFinancialYear() : undefined);

  // ── Filing pack — delegate to existing endpoint ──────────────────
  // The existing /api/tax/filing-pack/generate is a POST. To keep the
  // hub UX simple (always a GET → download), we proxy the call here.
  if (id === 'filing-pack' && format === 'zip') {
    const url = new URL('/api/tax/filing-pack/generate', request.url);
    if (fy) url.searchParams.set('fy', fy);
    return NextResponse.redirect(url.toString(), 307);
  }

  try {
    const baseFilename = safeFilename(`report-${id}${fy ? `-${fy}` : ''}`);

    // ── PDF dispatch ───────────────────────────────────────────────
    if (format === 'pdf') {
      let element: React.ReactElement<DocumentProps>;
      switch (id) {
        case 'networth': {
          const data = await fetchNetWorth({ userId });
          element = <NetWorthPdf data={data} />;
          break;
        }
        case 'income-summary': {
          const data = await fetchIncomeSummary({ userId, fy });
          element = <IncomeSummaryPdf data={data} />;
          break;
        }
        case 'section80': {
          const data = await fetchSection80({ userId, fy });
          element = <Section80Pdf data={data} />;
          break;
        }
        case 'capital-gains': {
          const data = await fetchCapitalGains({ userId, fy });
          element = <CapitalGainsPdf data={data} />;
          break;
        }
        case 'form80g': {
          const data = await fetchForm80g({ userId, fy });
          element = <Form80gPdf data={data} />;
          break;
        }
        case 'form26as-recon': {
          const data = await fetchForm26asRecon({ userId, fy });
          element = <Form26asReconPdf data={data} />;
          break;
        }
        case 'retirement': {
          const data = await fetchRetirementProjection({ userId });
          element = <RetirementPdf data={data} />;
          break;
        }
        case 'cashflow': {
          const data = await fetchCashflow({ userId, fy });
          element = <CashflowPdf data={data} />;
          break;
        }
        default:
          return NextResponse.json(
            { error: `No PDF generator for ${id}` },
            { status: 500 },
          );
      }
      const buf = await renderToBuffer(element);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': MIME_PDF,
          'Content-Disposition': attach(`${baseFilename}.pdf`),
        },
      });
    }

    // ── Excel dispatch ─────────────────────────────────────────────
    if (format === 'xlsx') {
      let buf: Buffer;
      switch (id) {
        case 'networth': {
          const data = await fetchNetWorth({ userId });
          buf = await buildNetWorthXlsx(data, userId);
          break;
        }
        case 'income-summary': {
          const data = await fetchIncomeSummary({ userId, fy });
          buf = await buildIncomeSummaryXlsx(data, userId);
          break;
        }
        case 'section80': {
          const data = await fetchSection80({ userId, fy });
          buf = await buildSection80Xlsx(data, userId);
          break;
        }
        case 'capital-gains': {
          const data = await fetchCapitalGains({ userId, fy });
          buf = await buildCapitalGainsXlsx(data, userId);
          break;
        }
        case 'form80g': {
          const data = await fetchForm80g({ userId, fy });
          buf = await buildForm80gXlsx(data, userId);
          break;
        }
        case 'retirement': {
          const data = await fetchRetirementProjection({ userId });
          buf = await buildRetirementXlsx(data, userId);
          break;
        }
        case 'cashflow': {
          const data = await fetchCashflow({ userId, fy });
          buf = await buildCashflowXlsx(data, userId);
          break;
        }
        default:
          return NextResponse.json(
            { error: `No Excel generator for ${id}` },
            { status: 500 },
          );
      }
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': MIME_XLSX,
          'Content-Disposition': attach(`${baseFilename}.xlsx`),
        },
      });
    }

    // ── CSV dispatch ───────────────────────────────────────────────
    if (format === 'csv') {
      let csv: string;
      switch (id) {
        case 'networth': {
          const data = await fetchNetWorth({ userId });
          csv = buildNetWorthCsv(data);
          break;
        }
        case 'income-summary': {
          const data = await fetchIncomeSummary({ userId, fy });
          csv = buildIncomeSummaryCsv(data);
          break;
        }
        case 'section80': {
          const data = await fetchSection80({ userId, fy });
          csv = buildSection80Csv(data);
          break;
        }
        case 'capital-gains': {
          const data = await fetchCapitalGains({ userId, fy });
          csv = buildCapitalGainsCsv(data);
          break;
        }
        case 'form26as-recon': {
          const data = await fetchForm26asRecon({ userId, fy });
          csv = buildForm26asReconCsv(data);
          break;
        }
        case 'cashflow': {
          const data = await fetchCashflow({ userId, fy });
          csv = buildCashflowCsv(data);
          break;
        }
        default:
          return NextResponse.json(
            { error: `No CSV generator for ${id}` },
            { status: 500 },
          );
      }
      return new NextResponse(csv, {
        headers: {
          'Content-Type': MIME_CSV,
          'Content-Disposition': attach(`${baseFilename}.csv`),
        },
      });
    }

    // Unhandled — should be unreachable due to the formats gate above.
    return NextResponse.json(
      { error: `Unhandled format: ${format}` },
      { status: 400 },
    );
  } catch (err) {
    console.error(`[/api/reports/${id}/${format}]`, err);
    return NextResponse.json(
      {
        error: 'Failed to generate report',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
