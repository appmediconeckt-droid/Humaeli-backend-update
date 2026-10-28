import { fail } from '../utils/clinicAccess.js';

// Live money movement always requires an explicit mode switch.
export const paymentMode = () => process.env.PAYMENTS_MODE === 'live' ? 'live' : 'test';
export const paymentRecordMode = () => paymentMode() === 'test' ? 'test' : 'real';
export function requireGatewayEnvironment(keyId, secret) {
  if (!keyId?.startsWith(`rzp_${paymentMode()}_`) || !secret) {
    throw fail(503, `Configure ${paymentMode()} Razorpay credentials for the selected payment environment.`);
  }
}
export function requireRecordEnvironment(record) {
  if (record.mode !== paymentRecordMode()) throw fail(409, 'This payment belongs to another environment. Create a new appointment in the current mode.');
  if (record.gatewayKeyId && record.gatewayKeyId !== process.env.RAZORPAY_KEY_ID) throw fail(409, 'This payment belongs to another Razorpay account. Restore its original credentials to reconcile it.');
}
export const payoutBankFields = () => paymentMode() === 'test'
  ? { id: 'payoutTestFundAccountId', fingerprint: 'payoutTestBankFingerprint', key: 'payoutTestKeyId' }
  : { id: 'payoutFundAccountId', fingerprint: 'payoutBankFingerprint', key: 'payoutBankKeyId' };
