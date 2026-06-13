/**
 * Self-host detection.
 *
 * True on single-tenant self-host deployments (e.g. vaspar-pfd) where the
 * logged-in user is the operator and may manage app-wide secrets — the
 * Telegram bot token, the OpenAI key — from the UI, persisted to the volume
 * secrets. The public multi-tenant SaaS leaves these as deploy-time env vars
 * and keeps this false, so end users can't change app-wide keys.
 */
export function isSelfHost(): boolean {
  return (
    process.env.SELF_HOST === 'true' ||
    process.env.DEMO_PERSONAL_SWITCH === 'true' ||
    (process.env.TELEGRAM_CONNECT_MODE ?? '').toLowerCase() === 'getupdates'
  );
}
