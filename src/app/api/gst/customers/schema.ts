/**
 * Shared body schema for POST /api/gst/customers and PUT /api/gst/customers/[id]
 * (both accept the same shape). Lives outside route.ts because Next.js
 * route files may only export HTTP-method handlers.
 *
 * GSTIN validity, GSTIN↔state match, state-code validity and supply-type
 * normalisation remain manual checks in the handlers so their specific
 * error messages are preserved.
 */

import { z } from 'zod';

export const customerBodySchema = z.object({
  name: z.string().min(1),
  gstin: z.string().nullable().optional(),
  pan: z.string().nullable().optional(),
  stateCode: z.string().min(1),
  supplyType: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  pincode: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  tdsRatePct: z.number().finite().nullable().optional(),
  tdsSection: z.string().nullable().optional(),
});

export type CustomerBody = z.infer<typeof customerBodySchema>;
