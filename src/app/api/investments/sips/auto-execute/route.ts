import { NextResponse } from 'next/server';

// TODO(sprint-2): per-tenant cron scheduler. Currently disabled because
// the original logic assumed a single-user installation. See
// ORCHESTRATOR_CONTEXT.md Sprint 2 Phase 5 for the planned per-tenant
// job ledger.

export async function POST() {
  return NextResponse.json(
    { error: 'Service Unavailable — per-tenant cron not yet implemented' },
    { status: 503 },
  );
}
