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
  Select,
} from '@dxp/ui';
import { Upload, Loader2, FileCheck2, ArrowRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

/** Last 7 FYs ending with current — covers "filing last FY now" + 5 prior
 *  + the current ongoing FY. Wide enough to never block a legitimate
 *  override choice. */
function recentFys(): string[] {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const s = startYear - i + 1; // include next FY too (filing-ahead case)
    out.push(`${s - 1}-${String(s % 100).padStart(2, '0')}`);
  }
  // dedupe + return newest-first
  return Array.from(new Set(out));
}

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
  salaryTdsPaisa: number;
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
  const [overrideFy, setOverrideFy] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mappings, setMappings] = useState({
    salary: true,
    setupParams: true,
    realEstate: true,
    deductions: true,
    tds: true,
    capitalGains: false, // CG default off — high-risk for over-import
  });
  const fileRef = useRef<HTMLInputElement>(null);

  /** Client-side validation + reject early to keep the spinner honest. */
  const validateFile = (file: File): string | null => {
    if (file.size > 5 * 1024 * 1024) {
      return `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — max 5 MB.`;
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      return `Unsupported type: ${file.name.split('.').pop()}. Use .xlsx or .xls.`;
    }
    return null;
  };

  const handleUpload = async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/imports/yeswanth-taxcalc', { method: 'POST', body: fd });
      if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
      const data = await r.json();
      setImportId(data.importId);
      setPreview(data.preview);
      // Default override = detected FY. The user can correct it if the
      // template's sheet name doesn't match their filing intent.
      setOverrideFy(data.preview.fy);
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
        // overrideFy lets the user correct the FY at confirm time (e.g.
        // template sheet name says one FY but they're importing a copy
        // meant for a different filing year).
        body: JSON.stringify({ importId, mappings, overrideFy }),
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
            {/* The whole label IS the click + drop target. The native
                input is sr-only so its tiny "Choose file" button never
                eats clicks meant for the dashed area. */}
            <label
              htmlFor="yeswanth-file-input"
              onDragOver={(e) => {
                e.preventDefault();
                if (!uploading) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (uploading) return;
                const file = e.dataTransfer.files?.[0];
                if (file) handleUpload(file);
              }}
              className={`flex flex-col items-center justify-center gap-3 rounded border-2 border-dashed p-10 transition-colors ${
                uploading
                  ? 'cursor-wait border-[var(--dxp-border)] bg-[var(--dxp-surface)]'
                  : dragOver
                    ? 'cursor-pointer border-blue-400 bg-blue-50'
                    : 'cursor-pointer border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-[var(--dxp-text-muted)] hover:bg-[var(--dxp-border-light)]'
              }`}
            >
              <input
                ref={fileRef}
                id="yeswanth-file-input"
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  // Reset the input so picking the same file twice re-fires onChange.
                  e.target.value = '';
                }}
                className="sr-only"
                disabled={uploading}
              />
              {uploading ? (
                <>
                  <Loader2 className="h-10 w-10 animate-spin text-[var(--dxp-text-muted)]" />
                  <p className="text-sm font-semibold text-[var(--dxp-text)]">Parsing…</p>
                  <p className="text-xs text-[var(--dxp-text-muted)]">
                    Reading sheets, computing annual sums, validating.
                  </p>
                </>
              ) : (
                <>
                  <Upload className={`h-10 w-10 ${dragOver ? 'text-blue-500' : 'text-[var(--dxp-text-muted)]'}`} />
                  <p className="text-base font-semibold text-[var(--dxp-text)]">
                    {dragOver ? 'Drop the xlsx here' : 'Click to choose a file or drag-drop it here'}
                  </p>
                  <p className="text-xs text-[var(--dxp-text-muted)] text-center max-w-md">
                    .xlsx or .xls · Max 5 MB · Stored under{' '}
                    <code>uploads/&lt;you&gt;/yeswanth-imports/</code> (gitignored). Re-uploading the
                    same file produces the same preview.
                  </p>
                </>
              )}
            </label>
          </CardContent>
        </Card>
      )}

      {preview && (
        <>
          <Card>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                Step 2 — Review &amp; confirm
              </h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Check sections to import. Salary &amp; setup will UPSERT (overwrite existing
                row for this FY). Deductions, TDS, and capital gains will INSERT new rows
                (no de-duplication — re-importing creates duplicates).
              </p>
              {/* FY banner — prominent because the wrong FY silently
                  misfiles the entire import. Override surfaces here, not
                  buried in a dropdown later. */}
              <div className={`mt-3 rounded border p-3 ${
                overrideFy !== preview.fy
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)]'
              }`}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                    overrideFy !== preview.fy ? 'text-amber-600' : 'text-[var(--dxp-text-muted)]'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--dxp-text)]">
                      {overrideFy !== preview.fy
                        ? `Importing as FY ${overrideFy} (overriding detected FY ${preview.fy})`
                        : `This will import as FY ${preview.fy}`}
                    </p>
                    <p className="text-xs text-[var(--dxp-text-muted)] mt-0.5">
                      Detected from file&apos;s sheet name. Override if the template&apos;s
                      naming doesn&apos;t match your filing intent.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-[var(--dxp-text-muted)]">Import as:</span>
                      <div className="w-36">
                        <Select
                          options={recentFys().map((y) => ({ value: y, label: `FY ${y}` }))}
                          value={overrideFy}
                          onChange={setOverrideFy}
                        />
                      </div>
                      {overrideFy !== preview.fy && (
                        <button
                          type="button"
                          onClick={() => setOverrideFy(preview.fy)}
                          className="text-xs text-[var(--dxp-text-muted)] hover:underline"
                        >
                          reset to detected
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
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
                <KV label="Salary TDS (employer-deducted)" value={fmtINR(preview.salaryAnnual.salaryTdsPaisa / 100)} />
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
