/**
 * Telegram Bot API helper — STUBBED.
 *
 * See STUBS.md #3. Per-tenant Telegram routing (one bot vs many bot
 * tokens, chat IDs, etc.) is an unsolved design question for SaaS.
 * Until it's resolved (Sprint 5+), this helper:
 *
 *   - Logs the message to console with a banner.
 *   - Appends a {ts, text} JSON line to tmp/telegram-out.log.
 *   - Returns true so callers (alert dedup, digest scheduling) think
 *     delivery succeeded — otherwise an alert would re-fire every tick.
 *
 * If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are BOTH set, the
 * helper falls through to the real Telegram API (the single-tenant
 * personal-v1 path). That's how the original owner can keep using
 * Telegram on their own install; multi-tenant deployments leave the
 * env vars empty and get the stub.
 */

import fs from 'node:fs';
import path from 'node:path';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

const STUB_LOG = path.join(process.cwd(), 'tmp', 'telegram-out.log');

function writeStub(text: string): void {
  const ts = new Date().toISOString();
  const banner = '─'.repeat(72);
  console.log(`\n${banner}`);
  console.log(`📨  TELEGRAM (stub — no message sent)`);
  console.log(`    ${text.split('\n').join('\n    ')}`);
  console.log(`${banner}\n`);
  try {
    fs.mkdirSync(path.dirname(STUB_LOG), { recursive: true });
    fs.appendFileSync(STUB_LOG, JSON.stringify({ ts, text }) + '\n');
  } catch (err) {
    console.error('[telegram-stub] could not write telegram-out.log:', err);
  }
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    writeStub(text);
    return true; // success: callers should treat the stub as delivered
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    const result = await res.json();
    if (!result.ok) {
      console.error('Telegram API error:', result.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Telegram send failed:', err);
    return false;
  }
}
