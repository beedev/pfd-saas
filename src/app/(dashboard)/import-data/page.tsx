'use client';

/**
 * Desktop-only "Import from backup" screen. Upload a production pg_dump and it
 * replaces the local database with prod's exact state (see /api/desktop/import-db).
 */
import { useState } from 'react';
import { Card, CardHeader, CardContent, Button } from '@dxp/ui';
import { Upload, Loader2, CheckCircle2, AlertTriangle, Database } from 'lucide-react';

export default function ImportDataPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; error?: string; tables?: number; users?: number } | null>(null);

  async function doImport() {
    if (!file || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('backup', file);
      const r = await fetch('/api/desktop/import-db', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Import failed (${r.status})`);
      setResult(data);
      // Session table was replaced — send the user back to pick an account.
      setTimeout(() => { window.location.href = '/login'; }, 2500);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : 'Import failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Import from backup</h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Restore this app from a production database backup.
        </p>
      </div>

      <Card className="border-l-4 border-l-amber-500 bg-amber-50/40">
        <CardContent>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
            <div className="text-sm text-[var(--dxp-text-secondary)]">
              This <strong>replaces everything</strong> in the local app with the
              contents of the backup. Make a backup first if you have local data
              you want to keep. You&rsquo;ll be signed out and asked to pick an
              account again after the import.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Database className="h-5 w-5 text-[var(--dxp-brand)]" /> Backup file
          </h3>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            A <code>pg_dump</code> SQL file, e.g. from{' '}
            <code>pg_dump &quot;$DATABASE_URL&quot; --no-owner --no-privileges --inserts</code>.
          </p>
        </CardHeader>
        <CardContent>
          <input
            type="file"
            accept=".sql,.gz,text/plain,application/sql,application/gzip"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }}
            disabled={busy}
            className="block w-full text-sm text-[var(--dxp-text-secondary)] file:mr-4 file:rounded-lg file:border-0 file:bg-[var(--dxp-brand)] file:px-4 file:py-2 file:text-white hover:file:opacity-90"
          />
          {file && (
            <p className="mt-2 text-xs text-[var(--dxp-text-muted)]">
              {file.name} · {(file.size / 1e6).toFixed(1)} MB
            </p>
          )}

          <Button variant="primary" onClick={doImport} disabled={!file || busy} className="mt-4">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {busy ? 'Importing…' : 'Import backup'}
          </Button>

          {result?.ok && (
            <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              Imported {result.tables} tables, {result.users} accounts. Signing you out…
            </div>
          )}
          {result?.error && (
            <div className="mt-4 flex items-start gap-2 text-sm text-rose-700">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              {result.error}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
