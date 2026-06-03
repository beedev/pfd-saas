/**
 * /login — server component.
 *
 * Sprint 6.1.9c: dispatches between two flows based on the
 * DEMO_PERSONAL_SWITCH env var, which is read here on the server so
 * client components don't need it leaked through bundles.
 *
 *   - DEMO_PERSONAL_SWITCH=true (Docker self-host default) →
 *     <AccountChooser />: two cards, click-to-sign-in via
 *     /api/auth/switch-account. No email, no JS required.
 *
 *   - anything else (production SaaS) →
 *     <MagicLinkForm />: the original email magic-link form. Byte-for-
 *     byte identical to the pre-6.1.9 page; clients hit signIn() then
 *     poll /api/auth/pending-link or wait for SMTP delivery.
 *
 * Both children are responsible for their own page layout/background.
 */

import { AccountChooser } from './account-chooser';
import { MagicLinkForm } from './magic-link-form';

export default function LoginPage() {
  if (process.env.DEMO_PERSONAL_SWITCH === 'true') {
    return <AccountChooser />;
  }
  return <MagicLinkForm />;
}
