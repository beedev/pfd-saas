/**
 * Fetch daily digest from localhost:9999 and send as Telegram message.
 * Runs standalone via Node.js — no Next.js dependency.
 *
 * Telegram creds come from .env.local at the repo root. The launchd plist
 * exports them into the script's environment via a helper line.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env.local manually so the script can be run by launchd without an
// interactive shell. Tiny key=value parser — no quoting/multi-line support.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[m[1]] = val;
    }
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';
if (!BOT_TOKEN || !CHAT_ID) {
  console.error(
    'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing from .env.local — aborting',
  );
  process.exit(1);
}
const DIGEST_URL = 'http://localhost:9999/api/daily-digest';

const formatINR = (paisa) => {
  const rupees = paisa / 100;
  if (Math.abs(rupees) >= 10000000) return `₹${(rupees / 10000000).toFixed(2)}Cr`;
  if (Math.abs(rupees) >= 100000) return `₹${(rupees / 100000).toFixed(2)}L`;
  if (Math.abs(rupees) >= 1000) return `₹${(rupees / 1000).toFixed(1)}K`;
  return `₹${Math.round(rupees).toLocaleString('en-IN')}`;
};

const formatNum = (n, dec = 2) => n.toFixed(dec);
const sign = (n) => (n >= 0 ? '+' : '');

async function main() {
  // 1. Fetch digest
  const res = await fetch(DIGEST_URL);
  if (!res.ok) {
    console.error(`Digest API error: ${res.status}`);
    process.exit(1);
  }
  const d = await res.json();

  const lines = [];
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  // Header
  lines.push(`☀️ *Daily Digest — ${today}*`);
  lines.push(`_${d.marketPulse.marketState === 'REGULAR' ? '🟢 Market Open' : '🔴 Market Closed'}_`);
  lines.push('');

  // Market Pulse
  lines.push('📊 *Market Pulse*');
  for (const idx of d.marketPulse.indices) {
    const arrow = idx.change >= 0 ? '🟩' : '🟥';
    lines.push(`${arrow} ${idx.name}: *${formatNum(idx.value, idx.symbol === '^INDIAVIX' ? 2 : 0)}* (${sign(idx.changePercent)}${formatNum(idx.changePercent)}%)`);
  }
  for (const c of d.marketPulse.commodities) {
    const arrow = c.change >= 0 ? '🟩' : '🟥';
    lines.push(`${arrow} ${c.name}: *₹${c.value.toLocaleString('en-IN')}* (${sign(c.changePercent)}${formatNum(c.changePercent)}%)`);
  }
  const fx = d.marketPulse.forex;
  lines.push(`💱 USD/INR: *${formatNum(fx.usdInr)}* (${sign(fx.changePercent)}${formatNum(fx.changePercent)}%)`);
  lines.push('');

  // Portfolio
  if (d.portfolio.hasSnapshot) {
    lines.push('💰 *Portfolio*');
    lines.push(`Net Worth: *${formatINR(d.portfolio.netWorth)}*`);
    if (d.portfolio.netWorthChange !== 0) {
      const pct = d.portfolio.netWorthChangePercent;
      lines.push(`Day Change: ${sign(d.portfolio.netWorthChange)}${formatINR(Math.abs(d.portfolio.netWorthChange))} (${sign(pct)}${formatNum(pct)}%)`);
    }
    if (d.portfolio.breakdown.length > 0) {
      const top = d.portfolio.breakdown
        .filter((b) => b.value > 0)
        .sort((a, b) => b.value - a.value);
      for (const b of top) {
        const ch = b.change !== 0 ? ` (${sign(b.change)}${formatINR(Math.abs(b.change))})` : '';
        lines.push(`  • ${b.name}: ${formatINR(b.value)}${ch}`);
      }
    }
    lines.push('');
  }

  // MF Movers
  if (d.mfMovers.gainers.length > 0) {
    lines.push('📈 *Top Gainers*');
    for (const m of d.mfMovers.gainers) {
      lines.push(`  🟩 ${m.name.substring(0, 30)}… +${m.returnPercent}%`);
    }
    lines.push('');
  }
  if (d.mfMovers.losers.length > 0) {
    lines.push('📉 *Underperformers*');
    for (const m of d.mfMovers.losers) {
      lines.push(`  🟥 ${m.name.substring(0, 30)}… ${m.returnPercent}%`);
    }
    lines.push('');
  }

  // Budget snapshot — current month progress + pending items
  if (d.budget && (d.budget.totalPlanned > 0 || d.budget.totalActual > 0)) {
    const b = d.budget;
    const periodLabel = (() => {
      const m = parseInt(b.period.substring(0, 2), 10);
      const y = parseInt(b.period.substring(2, 6), 10);
      const date = new Date(y, m - 1, 1);
      return date.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    })();
    const pct = b.totalPlanned > 0 ? Math.round((b.totalActual / b.totalPlanned) * 100) : 0;
    lines.push(`💼 *Budget — ${periodLabel}*`);
    lines.push(`Spent: *${formatINR(b.totalActual)}* / ${formatINR(b.totalPlanned)} (${pct}%)`);
    lines.push(`🟢 ${b.paidCount} paid · 🔵 ${b.partialCount} partial · 🟡 ${b.unpaidCount} pending`);
    if (b.pending.length > 0) {
      const cap = Math.min(b.pending.length, 8);
      for (let i = 0; i < cap; i++) {
        const p = b.pending[i];
        const tag = p.status === 'partial' ? '🔵' : '🟡';
        const detail =
          p.status === 'partial'
            ? `${formatINR(p.actual)} of ${formatINR(p.planned)} (${formatINR(p.remaining)} left)`
            : formatINR(p.planned);
        lines.push(`  ${tag} ${p.name} — ${detail}`);
      }
      if (b.pending.length > cap) {
        lines.push(`  …and ${b.pending.length - cap} more`);
      }
    }
    lines.push('');
  }

  // Action Items
  const actions = d.actionItems;
  const cardsDue = actions.cardsDue ?? [];
  const totalActions =
    actions.sipsDue.length + actions.chitsDue.length +
    actions.insuranceDue.length + actions.loansDue.length + cardsDue.length;

  if (totalActions > 0) {
    lines.push(`⚡ *Action Items (${totalActions})*`);
    for (const s of actions.sipsDue) {
      const tag = s.isOverdue ? '🔴 OVERDUE' : '📅';
      lines.push(`  ${tag} SIP: ${s.schemeName} — ${formatINR(s.amount)} due ${s.dueDate}`);
    }
    for (const c of actions.chitsDue) {
      const tag = c.isOverdue ? '🔴 OVERDUE' : '📅';
      lines.push(`  ${tag} Chit: ${c.schemeName} — ${formatINR(c.amount)} due ${c.dueDate}`);
    }
    for (const p of actions.insuranceDue) {
      lines.push(`  📅 Insurance: ${p.insurer} #${p.policyNumber} — ${formatINR(p.amount)} due ${p.dueDate}`);
    }
    for (const l of actions.loansDue) {
      const tag = l.isOverdue ? '🔴 OVERDUE' : '📅';
      lines.push(`  ${tag} EMI: ${l.name} — ${formatINR(l.amount)} due ${l.dueDate}`);
    }
    for (const c of cardsDue) {
      const tag = c.isOverdue ? '🔴 OVERDUE' : '💳';
      lines.push(`  ${tag} CC: ${c.name} — outstanding ${formatINR(c.amount)} due ${c.dueDate}`);
    }
    lines.push('');
  } else {
    lines.push('✅ *No action items — you\'re all caught up!*');
    lines.push('');
  }

  // News
  if (d.news.markets.length > 0) {
    lines.push('📰 *Market Headlines*');
    for (const n of d.news.markets) {
      lines.push(`  • [${n.title}](${n.link})`);
    }
    lines.push('');
  }
  if (d.news.personalFinance.length > 0) {
    lines.push('💡 *Personal Finance*');
    for (const n of d.news.personalFinance) {
      lines.push(`  • [${n.title}](${n.link})`);
    }
  }

  const message = lines.join('\n');

  // 2. Send via Telegram Bot API
  const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const sendRes = await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });

  const result = await sendRes.json();
  if (result.ok) {
    console.log('Digest sent successfully to Telegram');
  } else {
    console.error('Telegram API error:', JSON.stringify(result));
    process.exit(1);
  }
}

async function runWithRetry(maxRetries = 3, delayMs = 30000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await main();
      return;
    } catch (err) {
      const isNetwork = err?.cause?.code === 'ENOTFOUND' || err?.cause?.code === 'ENETUNREACH' || err?.message?.includes('fetch failed');
      console.error(`Attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (!isNetwork || attempt === maxRetries) {
        process.exit(1);
      }
      console.log(`Network not ready, retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

runWithRetry();
