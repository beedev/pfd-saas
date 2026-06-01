'use client';

/**
 * /tax/import — Sprint 5.1d.
 *
 * Yeswanth TaxCalc xlsx importer with two-step flow:
 *   1. Upload .xlsx → preview JSON (no DB writes).
 *   2. Review section diffs + confirm with per-section checkboxes.
 *
 * Diff display compares EXISTING (current user data for FY) vs
 * EXTRACTED (from xlsx). User picks which sections to import.
 *
 * Important: parsed file content is sensitive — NOT logged. Preview
 * is displayed in-page only and never sent to telemetry.
 */

import { useState, useRef } from 'react';
import {
  Card,
  CardHeader,
  CardContent,
  Button,
  Badge,
} from '@dxp/ui';
import { Upload, Loader2, FileCheck2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

interface PreviewSalary {
  basicPaisa: number;
  daPaisa: number;
  hraReceivedPaisa: number;
  ltaPaisa: number;
  conveyancePaisa: number;
  childrenEdAllowancePaisa: number;
  medicalPaisa: number;
  otherAllowancesPaisa: number;
  rentPaidMonthlyPaisa: number;
}

interface Preview {
  fy: string;
  salaryAnnual: PreviewSalary;
  setupParams: Record<string, boolean | string | null | undefined>;
  housingLoan: Record<string, number | boolean>;
  deductions: Array<{ section: string; description: string; amountRupees: number; eightyDBucket?: string }>;
  dividends: Array<{ date: string; description: string; amountRupees: number; tdsRupees: number }>;
  bankInterest: Array<{ bankName: string; fdInterestRupees: number; tdsRupees: number; sbInterestRupees: number }>;
  taxesPaidOutsideSalary: Array<{ description: string; date: string; amountRupees: number }>;
  capitalGainsEquity: Array<{ scripName: string; purchaseDate: string; saleDate: string; purchaseRupees: number; saleRupees: number; longTermFlag: boolean }>;
  capitalGainsForeignEquity: Array<{ scripName: string; saleDate: string; saleRupees: number; longTermFlag: boolean }>;
  capitalGainsPropertyDebt: Array<{ scripName: string; saleDate: string; saleRupees: number; longTermFlag: boolean }>;
}

function fmtINR(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

export default function YeswanthImportPage() {
  const [importId, setImportId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [mappings, setMappings] = useState({
    salary: true,
    setupParams: true,
    realEstate: true,
    deductions: true,
    tds: true,
    capitalGains: false, // CG default off — high-risk for over-import
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/imports/yeswanth-taxcalc', { method: 'POST', body: fd });
      if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
      const data = await r.json();
      setImportId(data.importId);
      setPreview(data.preview);
      toast.success(`Parsed FY ${data.preview.fy} — review below before confirming.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!importId) return;
    setConfirming(true);
    try {
      const r = await fetch('/api/imports/yeswanth-taxcalc/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId, mappings }),
      });
      if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
      const data = await r.json();
      toast.success(
        `Imported: ${data.summary.salary ? 'salary, ' : ''}` +
          `${data.summary.setupParams ? 'setup, ' : ''}` +
          `${data.summary.realEstate ? 'real estate, ' : ''}` +
          `${data.summary.deductions} deduction(s), ` +
          `${data.summary.tds} TDS row(s), ` +
          `${data.summary.capitalGains} CG row(s)`,
      );
      // Reset for next import
      setImportId(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Confirm failed');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--dxp-text)]">Import from TaxCalc</h1>
        <p className="mt-1 text-sm text-[var(--dxp-text-secondary)]">
          Upload your Yeswanth TaxCalc xlsx file. The parser extracts salary components,
          deductions, setup params, housing loan, TDS, and capital gains. Nothing is written
          until you confirm.
        </p>
      </div>

      {!preview && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Step 1 — Upload xlsx</h3>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-6">
              <Upload className="h-8 w-8 text-[var(--dxp-text-muted)]" />
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
                className="text-sm"
                disabled={uploading}
              />
              <p className="text-xs text-[var(--dxp-text-muted)]">
                Max 5 MB. The file is stored under uploads/yeswanth-imports/&lt;you&gt;/
                (gitignored). Re-uploading the same file produces the same preview.
              </p>
              {uploading && (
                <p className="flex items-center gap-2 text-xs text-[var(--dxp-text-secondary)]">
                  <Loader2 className="h-3 w-3 animate-spin" /> Parsing…
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Step 2 — Review &amp; confirm
                </h3>
                <Badge variant="info">FY {preview.fy}</Badge>
              </div>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Check sections to import. Salary &amp; setup will UPSERT (overwrite existing
                row for this FY). Deductions, TDS, and capital gains will INSERT new rows
                (no de-duplication — re-importing creates duplicates).
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Section
                title="Salary components (UPSERT)"
                count={1}
                checked={mappings.salary}
                onChange={(v) => setMappings((m) => ({ ...m, salary: v }))}
              >
                <KV label="Basic" value={fmtINR(preview.salaryAnnual.basicPaisa / 100)} />
                <KV label="DA" value={fmtINR(preview.salaryAnnual.daPaisa / 100)} />
                <KV label="HRA received" value={fmtINR(preview.salaryAnnual.hraReceivedPaisa / 100)} />
                <KV label="LTA" value={fmtINR(preview.salaryAnnual.ltaPaisa / 100)} />
                <KV label="Conveyance" value={fmtINR(preview.salaryAnnual.conveyancePaisa / 100)} />
                <KV label="Children Ed" value={fmtINR(preview.salaryAnnual.childrenEdAllowancePaisa / 100)} />
                <KV label="Medical" value={fmtINR(preview.salaryAnnual.medicalPaisa / 100)} />
                <KV label="Other allowances" value={fmtINR(preview.salaryAnnual.otherAllowancesPaisa / 100)} />
                <KV label="Rent paid (monthly)" value={fmtINR(preview.salaryAnnual.rentPaidMonthlyPaisa / 100)} />
              </Section>

              <Section
                title="Tax setup parameters (MERGE)"
                count={Object.values(preview.setupParams).filter((v) => v !== undefined).length}
                checked={mappings.setupParams}
                onChange={(v) => setMappings((m) => ({ ...m, setupParams: v }))}
              >
                {Object.entries(preview.setupParams)
                  .filter(([, v]) => v !== undefined && v !== null)
                  .map(([k, v]) => (
                    <KV key={k} label={k} value={String(v)} />
                  ))}
              </Section>

              <Section
                title="Housing loan / Self-occupied property (UPSERT)"
                count={preview.housingLoan.homeLoanInterestSelfOccupiedRupees as number > 0 ||
                  preview.housingLoan.homeLoanInterestRentedRupees as number > 0 ? 1 : 0}
                checked={mappings.realEstate}
                onChange={(v) => setMappings((m) => ({ ...m, realEstate: v }))}
              >
                <KV label="Rental income (annual)" value={fmtINR(preview.housingLoan.rentalIncomeAnnualRupees as number)} />
                <KV label="Home loan interest (self-occ)" value={fmtINR(preview.housingLoan.homeLoanInterestSelfOccupiedRupees as number)} />
                <KV label="Home loan interest (rented)" value={fmtINR(preview.housingLoan.homeLoanInterestRentedRupees as number)} />
                <KV label="Municipal taxes" value={fmtINR(preview.housingLoan.municipalTaxesAnnualRupees as number)} />
                <KV label="Loan post-Apr-1999?" value={String(preview.housingLoan.loanTakenAfter1Apr1999)} />
                <KV label="80EEA eligible?" value={String(preview.housingLoan.section80EeaEligible)} />
              </Section>

              <Section
                title="Deductions (INSERT)"
                count={preview.deductions.length}
                checked={mappings.deductions}
                onChange={(v) => setMappings((m) => ({ ...m, deductions: v }))}
              >
                {preview.deductions.length === 0 ? (
                  <p className="text-xs text-[var(--dxp-text-muted)]">No deductions detected.</p>
                ) : (
                  <table className="min-w-full text-xs">
                    <thead className="text-[var(--dxp-text-secondary)]">
                      <tr>
                        <th className="text-left">Section</th>
                        <th className="text-left">Description</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.deductions.map((d, i) => (
                        <tr key={i} className="border-t border-[var(--dxp-border-light)]">
                          <td>{d.section}</td>
                          <td>{d.description}</td>
                          <td className="text-right font-mono">{fmtINR(d.amountRupees)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              <Section
                title="TDS / Taxes paid outside salary (INSERT)"
                count={preview.taxesPaidOutsideSalary.length + preview.bankInterest.length}
                checked={mappings.tds}
                onChange={(v) => setMappings((m) => ({ ...m, tds: v }))}
              >
                <p className="text-xs text-[var(--dxp-text-muted)]">
                  {preview.taxesPaidOutsideSalary.length} advance-tax row(s) +{' '}
                  {preview.bankInterest.length} bank-interest TDS row(s).
                </p>
              </Section>

              <Section
                title="Capital gains (INSERT) — OFF by default"
                count={preview.capitalGainsEquity.length + preview.capitalGainsForeignEquity.length + preview.capitalGainsPropertyDebt.length}
                checked={mappings.capitalGains}
                onChange={(v) => setMappings((m) => ({ ...m, capitalGains: v }))}
              >
                <p className="text-xs text-[var(--dxp-text-muted)]">
                  Equity {preview.capitalGainsEquity.length} · Foreign equity{' '}
                  {preview.capitalGainsForeignEquity.length} · Property/Debt{' '}
                  {preview.capitalGainsPropertyDebt.length} row(s). Re-import creates
                  duplicates — leave OFF unless first-time import.
                </p>
              </Section>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => { setPreview(null); setImportId(null); }}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleConfirm} disabled={confirming}>
                  {confirming && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  <FileCheck2 className="mr-1 h-3 w-3" />
                  Confirm import <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  checked,
  onChange,
  children,
}: {
  title: string;
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-[var(--dxp-border)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-semibold text-sm text-[var(--dxp-text)]">{title}</span>
          <Badge variant="default">{count}</Badge>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-[var(--dxp-border-light)] py-0.5">
      <span className="text-[var(--dxp-text-secondary)]">{label}</span>
      <span className="font-mono text-[var(--dxp-text)]">{value}</span>
    </div>
  );
}
