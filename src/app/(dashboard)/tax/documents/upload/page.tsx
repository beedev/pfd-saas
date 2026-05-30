'use client';

import { useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Input, Select } from '@dxp/ui';
import { Loader2, Upload } from 'lucide-react';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--dxp-text)]">{label}</label>
      {children}
    </div>
  );
}

const CATEGORIES = [
  'DONATION_RECEIPT',
  '80G_CERTIFICATE',
  'INSURANCE_RECEIPT',
  'POLICY_BOND',
  'INVESTMENT_PROOF',
  'BANK_STATEMENT',
  'INTEREST_CERT',
  'RENT_RECEIPT',
  'MEDICAL_BILL',
  'TUITION_FEE',
  'OTHER',
];

interface PendingFile {
  file: File;
  title: string;
  category: string;
  financialYear: string;
}

export default function DocumentUploadPage() {
  const router = useRouter();
  const [items, setItems] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const fy = getCurrentFinancialYear();
    const next = Array.from(files).map((f) => ({
      file: f,
      title: f.name,
      category: 'OTHER',
      financialYear: fy,
    }));
    setItems((prev) => [...prev, ...next]);
  };

  const update = (idx: number, patch: Partial<PendingFile>) => {
    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const remove = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (items.length === 0) {
      toast.error('No files selected');
      return;
    }
    setIsUploading(true);
    try {
      for (const item of items) {
        const fd = new FormData();
        fd.append('file', item.file);
        fd.append('title', item.title);
        fd.append('category', item.category);
        fd.append('financialYear', item.financialYear);
        const r = await fetch('/api/tax/documents', { method: 'POST', body: fd });
        if (!r.ok) throw new Error(`Upload failed for ${item.file.name}`);
      }
      toast.success(`Uploaded ${items.length} document${items.length === 1 ? '' : 's'}`);
      router.push('/tax/documents');
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const catOpts = CATEGORIES.map((c) => ({ value: c, label: c }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Upload Documents</h1>
        <p className="text-[var(--dxp-text-secondary)]">Drag-drop files or browse to add to your vault</p>
      </div>

      <Card>
        <CardContent>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFiles(e.dataTransfer.files);
            }}
            className="flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-[var(--dxp-border)] p-8 text-center"
          >
            <Upload className="h-10 w-10 text-[var(--dxp-text-muted)]" />
            <p className="text-sm text-[var(--dxp-text-secondary)]">Drop files here or</p>
            <label className="cursor-pointer">
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
              <span className="rounded bg-[var(--dxp-brand)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                Browse files
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {items.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Pending uploads ({items.length})</h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="rounded border border-[var(--dxp-border-light)] p-3">
                  <p className="text-xs font-mono text-[var(--dxp-text-muted)]">{item.file.name}</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <Field label="Title">
                      <Input value={item.title} onChange={(e) => update(idx, { title: e.target.value })} />
                    </Field>
                    <Field label="Category">
                      <Select
                        options={catOpts}
                        value={item.category}
                        onChange={(v) => update(idx, { category: v })}
                      />
                    </Field>
                    <Field label="FY">
                      <Input
                        value={item.financialYear}
                        onChange={(e) => update(idx, { financialYear: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => remove(idx)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Link href="/tax/documents">
                <Button variant="secondary">Cancel</Button>
              </Link>
              <Button variant="primary" onClick={submit} disabled={isUploading}>
                {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Upload all
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
