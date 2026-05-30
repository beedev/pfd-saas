'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, DataTable, Badge, Input, Select, type Column } from '@dxp/ui';
import { Plus, Loader2, FolderOpen, Download, Trash2, Eye } from 'lucide-react';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

interface Doc {
  id: number;
  title: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  category: string | null;
  financialYear: string | null;
  deductionId: number | null;
  uploadedAt: number | string | null;
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

const formatBytes = (bytes: number | null) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function generateFyOptions(): Array<{ value: string; label: string }> {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]);
  const opts = [{ value: '', label: 'All years' }];
  for (let i = 2; i >= -1; i--) {
    const s = startYear - i;
    const e = String((s + 1) % 100).padStart(2, '0');
    opts.push({ value: `${s}-${e}`, label: `FY ${s}-${e}` });
  }
  return opts;
}

export default function DocumentsVaultPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fy, setFy] = useState(() => {
    const current = getCurrentFinancialYear();
    const s = Number(current.split('-')[0]) - 1;
    return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
  });
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<Doc | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fy) params.set('fy', fy);
      if (category) params.set('category', category);
      if (search) params.set('search', search);
      const r = await fetch(`/api/tax/documents?${params}`).then((r) => r.json());
      setDocs(r.documents || []);
    } finally {
      setIsLoading(false);
    }
  }, [fy, category, search]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this document?')) return;
    try {
      await fetch(`/api/tax/documents/${id}`, { method: 'DELETE' });
      toast.success('Deleted');
      await load();
    } catch (e) {
      toast.error('Failed to delete');
      console.error(e);
    }
  };

  const catOpts = [{ value: '', label: 'All categories' }, ...CATEGORIES.map((c) => ({ value: c, label: c }))];

  const columns: Column<Doc>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (_v, d) => (
        <div>
          <p className="font-semibold text-[var(--dxp-text)]">{d.title || d.fileName}</p>
          <p className="text-xs text-[var(--dxp-text-muted)]">{d.fileName}</p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (_v, d) => (d.category ? <Badge variant="info">{d.category}</Badge> : <span>—</span>),
    },
    {
      key: 'financialYear',
      header: 'FY',
      render: (_v, d) => <span className="font-mono text-xs">{d.financialYear}</span>,
    },
    {
      key: 'fileSize',
      header: 'Size',
      render: (_v, d) => <span className="text-xs">{formatBytes(d.fileSize)}</span>,
    },
    {
      key: 'deductionId',
      header: 'Linked',
      render: (_v, d) => (d.deductionId ? <Badge variant="success">#{d.deductionId}</Badge> : <span className="text-xs text-[var(--dxp-text-muted)]">—</span>),
    },
    {
      key: 'id',
      header: '',
      render: (_v, d) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setPreview(d)}>
            <Eye className="h-4 w-4" />
          </Button>
          <a href={`/api/tax/documents/${d.id}/download`} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              <Download className="h-4 w-4" />
            </Button>
          </a>
          <Button variant="ghost" size="sm" onClick={() => handleDelete(d.id)}>
            <Trash2 className="h-4 w-4 text-rose-500" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Document Vault</h1>
          <p className="text-[var(--dxp-text-secondary)]">All your tax documents in one place</p>
        </div>
        <Link href="/tax/documents/upload">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" /> Upload
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <Input placeholder="Search titles..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select options={catOpts} value={category} onChange={setCategory} />
            <Select options={generateFyOptions()} value={fy} onChange={setFy} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <FolderOpen className="h-5 w-5 text-[var(--dxp-brand)]" /> Documents ({docs.length})
          </h3>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
            </div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <FolderOpen className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">No documents found.</p>
              <Link href="/tax/documents/upload">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" /> Upload document
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<Doc> columns={columns} data={docs} emptyMessage="No documents" />
          )}
        </CardContent>
      </Card>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreview(null)}
        >
          <Card className="max-h-[90vh] w-full max-w-4xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">{preview.title || preview.fileName}</h3>
                <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[70vh] w-full overflow-auto bg-gray-100">
                {preview.mimeType?.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/tax/documents/${preview.id}/download`}
                    alt={preview.title || ''}
                    className="mx-auto max-h-full"
                  />
                ) : (
                  <object
                    data={`/api/tax/documents/${preview.id}/download`}
                    type={preview.mimeType || 'application/pdf'}
                    width="100%"
                    height="100%"
                  >
                    <p className="p-4 text-center text-sm">
                      Preview not available.{' '}
                      <a
                        href={`/api/tax/documents/${preview.id}/download`}
                        className="text-[var(--dxp-brand)] underline"
                      >
                        Download
                      </a>
                    </p>
                  </object>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
