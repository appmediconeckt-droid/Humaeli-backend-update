import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const mode = process.env.PAYMENTS_MODE === 'live' ? 'live' : 'test';
const configured = prefix => Boolean(process.env[`${prefix}_KEY_ID`]?.startsWith(`rzp_${mode}_`) && process.env[`${prefix}_KEY_SECRET`]);
const checks = [
  ['Payment environment', mode],
  ['Razorpay payment credentials', configured('RAZORPAY') ? 'READY' : 'MISSING OR WRONG MODE: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET'],
  ['RazorpayX payout credentials', configured('RAZORPAYX') ? 'READY' : 'MISSING OR WRONG MODE: RAZORPAYX_KEY_ID / RAZORPAYX_KEY_SECRET'],
  ['RazorpayX payout account', process.env.RAZORPAYX_ACCOUNT_NUMBER ? 'READY' : 'MISSING: RAZORPAYX_ACCOUNT_NUMBER'],
  ['Doctor payouts switch', process.env.DOCTOR_BANK_PAYOUTS_ENABLED === 'true' ? 'ENABLED' : 'DISABLED'],
  ['Payment webhook', process.env.RAZORPAY_WEBHOOK_SECRET ? 'CONFIGURED (verify dashboard URL/events separately)' : 'MISSING: RAZORPAY_WEBHOOK_SECRET'],
];
checks.forEach(([label, value]) => console.log(`${label}: ${value}`));
if (process.argv.includes('--remote')) {
  for (const [label, prefix, path] of [['Payment gateway', 'RAZORPAY', 'orders'], ['Payout API', 'RAZORPAYX', 'payouts']]) {
    if (!configured(prefix)) { console.log(`${label} API: SKIPPED (credentials missing or wrong mode)`); continue; }
    try {
      // Read-only. Never log account records, credentials, response bodies or headers.
      const result = await fetch(`https://api.razorpay.com/v1/${path}?count=1`, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${Buffer.from(`${process.env[`${prefix}_KEY_ID`]}:${process.env[`${prefix}_KEY_SECRET`]}`).toString('base64')}` } });
      console.log(`${label} API: ${result.ok ? 'ACCESS OK' : `HTTP ${result.status} (check credentials/product access)`}`);
      await result.body?.cancel();
    } catch { console.log(`${label} API: NETWORK CHECK FAILED (check network/API access)`); }
  }
}
