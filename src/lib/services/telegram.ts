/**
 * Shared Telegram Bot API helper.
 * Sends messages via the HTTP API. Used by alerts and daily digest.
 */

// Telegram bot credentials are read from environment variables. Set
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local on each machine.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn(
      'telegram: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping send',
    );
    return false;
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
