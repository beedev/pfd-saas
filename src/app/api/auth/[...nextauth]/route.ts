/**
 * Catch-all route for Auth.js. Owns /api/auth/signin, /api/auth/signout,
 * /api/auth/callback/<provider>, /api/auth/session, /api/auth/csrf,
 * /api/auth/providers, /api/auth/verify-request, and the EmailProvider's
 * magic-link verify endpoint.
 *
 * Do not add other routes under /api/auth/* — Auth.js owns the namespace.
 */
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
