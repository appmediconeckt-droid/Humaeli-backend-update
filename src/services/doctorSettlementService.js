import crypto from 'node:crypto';
import { paymentMode, paymentRecordMode, requireGatewayEnvironment, requireRecordEnvironment, payoutBankFields } from './paymentEnvironment.js';
import Appointment from '../models/appointmentModel.js';
import AppointmentPayment from '../models/appointmentPaymentModel.js';
import Settings from '../models/providerPaymentSettingsModel.js';
import { fail } from '../utils/clinicAccess.js';
import { withAppointmentPaymentLock } from './appointmentPaymentService.js';
import { emitResourceUpdated } from './portalRealtimeService.js';

export const payoutsConfigured = () => process.env.DOCTOR_BANK_PAYOUTS_ENABLED === 'true' && Boolean(process.env.RAZORPAYX_KEY_ID?.startsWith(`rzp_${paymentMode()}_`) && process.env.RAZORPAYX_KEY_SECRET && process.env.RAZORPAYX_ACCOUNT_NUMBER);
export const bankFingerprint = bank => crypto.createHash('sha256').update(`${bank?.accountNumber || ''}:${bank?.ifscCode || ''}:${bank?.accountHolder || ''}`).digest('hex');
export const settlementGateway = {
  async request(path, body, key) {
    if (!payoutsConfigured()) throw fail(503, 'Bank payouts are not activated. Contact platform support.');
    requireGatewayEnvironment(process.env.RAZORPAYX_KEY_ID, process.env.RAZORPAYX_KEY_SECRET);
    const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAYX_KEY_ID}:${process.env.RAZORPAYX_KEY_SECRET}`).toString('base64')}`, 'Content-Type': 'application/json', ...(key ? { 'X-Payout-Idempotency': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw fail(502, 'RazorpayX could not confirm this request. Check test/live API access, payout balance and configuration; do not create a duplicate payout.');
    return data;
  },
};

export function validatedPayoutState(record, payout) {
  const payload = record.payoutPayload;
  if (!payload || !payout?.id || payout.amount !== payload.amount || payout.currency !== 'INR' || payout.fund_account_id !== payload.fund_account_id || payout.reference_id !== payload.reference_id || (record.payoutId && payout.id !== record.payoutId)) throw fail(502, 'Payout verification mismatch. Contact support.');
  const status = payout.status === 'processed' ? 'completed' : ['failed', 'reversed', 'cancelled', 'rejected'].includes(payout.status) ? 'failed' : 'processing';
  return { settlementStatus: status, payoutId: payout.id, payoutUtr: payout.utr || '', payoutFailure: status === 'failed' ? 'Bank payout failed or was reversed. Funds are available again.' : '', ...(status === 'completed' ? { settledAt: new Date() } : {}) };
}

export async function settleDoctorPayment(id, providerId, checkOnly = false) {
  return withAppointmentPaymentLock(id, async () => {
    let record = await AppointmentPayment.findOne({ _id: id, providerId }).select('+payoutPayload');
    if (!record || record.mode === 'demo' || record.status !== 'paid') throw fail(400, 'A collected real payment is required.');
    requireRecordEnvironment(record);
    if (record.payoutKeyId && record.payoutKeyId !== process.env.RAZORPAYX_KEY_ID) throw fail(409, 'Restore the original payout account credentials before reconciling this payout.');
    if (record.payoutId) {
      const payout = await settlementGateway.request(`payouts/${encodeURIComponent(record.payoutId)}`);
      const state = validatedPayoutState(record, payout);
      await AppointmentPayment.updateOne({ _id: id }, { $set: state });
      return state;
    }
    if (checkOnly && !record.payoutKey) return { settlementStatus: record.settlementStatus };
    // Persist the exact request before sending. A timeout keeps funds reserved.
    if (!record.payoutKey) {
      const appointment = await Appointment.findById(record.appointmentId);
      if (!appointment || !['completed'].includes(appointment.status) || ['canceled', 'no_show'].includes(appointment.queue_status)) throw fail(409, 'Complete the appointment before requesting settlement.');
      const fields = payoutBankFields();
      const settings = await Settings.findOne({ providerId }).select(`+${fields.id} +${fields.fingerprint} +${fields.key}`);
      if (!settings?.[fields.id] || settings[fields.fingerprint] !== bankFingerprint(settings.bankAccount) || settings[fields.key] !== process.env.RAZORPAYX_KEY_ID) throw fail(409, 'Your receiving bank account needs verification in this payment environment.');
      if (!payoutsConfigured()) throw fail(503, 'Bank payouts are not activated. Contact platform support.');
      const amount = record.amount - record.platformFee;
      if (!Number.isSafeInteger(amount) || amount < 100) throw fail(409, 'The payable amount must be at least INR 1.');
      const payoutPayload = { account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER, fund_account_id: settings[fields.id], amount, currency: 'INR', mode: 'NEFT', purpose: 'payout', queue_if_low_balance: true, reference_id: String(record._id), narration: 'Doctor appointment earning' };
      const reserved = { payoutKey: crypto.randomUUID(), payoutKeyId: process.env.RAZORPAYX_KEY_ID, payoutPayload, payoutRequestedAt: new Date(), settlementStatus: 'processing' };
      await AppointmentPayment.updateOne({ _id: id }, { $set: reserved });
      record = { ...record.toObject(), ...reserved };
    }
    // Do not replay an unknown result beyond the provider's idempotency window.
    if (Date.now() - new Date(record.payoutRequestedAt).getTime() > 6 * 86400000) throw fail(409, 'Payout needs manual reconciliation by platform support. Do not create another payout.');
    const payout = await settlementGateway.request('payouts', record.payoutPayload, record.payoutKey);
    const state = validatedPayoutState(record, payout);
    await AppointmentPayment.updateOne({ _id: id }, { $set: state });
    return state;
  });
}

let reconciliationRunning = false;
export async function reconcileDoctorSettlements() {
  if (reconciliationRunning || !payoutsConfigured()) return;
  reconciliationRunning = true;
  try {
    const records = await AppointmentPayment.find({ settlementStatus: 'processing', mode: paymentRecordMode(), status: 'paid' }).sort({ updatedAt: 1 }).limit(25).lean();
    for (const record of records) {
      try {
        await settleDoctorPayment(record._id, record.providerId, true);
        emitResourceUpdated('wallet', [record.providerId]);
      } catch { /* Keep uncertain money reserved; next run or support reconciles it. */ }
    }
  } finally { reconciliationRunning = false; }
}
