import { fail } from '../utils/clinicAccess.js';

export const PLATFORM_FEE_PERCENT = 20;
export function commissionSnapshot(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw fail(400, 'Invalid payment amount.');
  return { platformFeePercent: PLATFORM_FEE_PERCENT, platformFee: Math.round(amount * PLATFORM_FEE_PERCENT / 100) };
}
