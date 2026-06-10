/**
 * parseBody — zod-validated request-body parsing for route handlers.
 *
 * Convention (pairs with auth-guard.ts):
 *
 *   const parsed = await parseBody(request, schema);
 *   if (parsed.error) return parsed.error;
 *   const body = parsed.data; // fully typed
 *
 * Two failure modes, both → 400 (previously many handlers 500'd):
 *   • malformed JSON (request.json() throws)
 *   • schema mismatch (zod safeParse failure) — response carries a
 *     flattened `issues` array of "path: message" strings
 *
 * Success and failure are mutually exclusive via the `never` markers,
 * so `if (parsed.error) return parsed.error;` narrows `parsed.data`.
 */

import { NextResponse } from 'next/server';
import type { z } from 'zod';

export type ParseBodyResult<T> =
  | { data: T; error?: never }
  | { data?: never; error: NextResponse };

export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParseBodyResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      error: NextResponse.json(
        { error: 'invalid request body', issues: ['body must be valid JSON'] },
        { status: 400 },
      ),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    );
    return {
      error: NextResponse.json(
        { error: 'invalid request body', issues },
        { status: 400 },
      ),
    };
  }

  return { data: result.data };
}
