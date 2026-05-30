/**
 * Alert checker — calls the /api/alerts/check endpoint.
 * Runs via LaunchAgent every 2 hours during market hours.
 */

const CHECK_URL = 'http://localhost:9999/api/alerts/check';

async function main() {
  console.log(`[${new Date().toISOString()}] Running alert check...`);

  const res = await fetch(CHECK_URL, { method: 'POST' });
  const data = await res.json();

  console.log(`Checked: ${data.checked}, Triggered: ${data.triggered}, Sent: ${data.sent}, Deduped: ${data.deduplicated}`);
  if (data.errors?.length) {
    console.error('Errors:', data.errors.join('; '));
  }
}

async function runWithRetry(maxRetries = 3, delayMs = 15000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await main();
      return;
    } catch (err) {
      console.error(`Attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt === maxRetries) process.exit(1);
      console.log(`Retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

runWithRetry();
