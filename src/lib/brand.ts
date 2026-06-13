/**
 * Product branding.
 *
 * "pfd-saas" stays as the internal codename (repo, container, DB, env keys).
 * The user-facing product name is Artha. Personal/self-host instances can set
 * APP_OWNER to prefix it — e.g. APP_OWNER="Bharath" → "Bharath's Artha".
 *
 * PRODUCT_NAME is a plain constant safe to import into client components.
 * appName() reads APP_OWNER and must run server-side (layout, route handlers);
 * pass its result to client components as a prop when the owner prefix is
 * wanted in the UI.
 */
export const PRODUCT_NAME = 'Artha';

export const PRODUCT_TAGLINE = 'Your wealth, taxes & growth, in one place.';

/** Full display name, owner-prefixed on personal instances (server-only env). */
export function appName(): string {
  const owner = process.env.APP_OWNER?.trim();
  return owner ? `${owner}’s ${PRODUCT_NAME}` : PRODUCT_NAME;
}
