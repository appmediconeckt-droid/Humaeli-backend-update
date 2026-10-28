import crypto from 'node:crypto';
import { appointmentAdditionalFee } from '../services/appointmentFees.js';
import { paymentMode, paymentRecordMode, payoutBankFields } from '../services/paymentEnvironment.js';
import Appointment from '../models/appointmentModel.js';
import AppointmentPayment from '../models/appointmentPaymentModel.js';
import User from '../models/userModel.js';
import Transaction from '../models/transactionModel.js';
import { Clinic } from '../models/clinicModels.js';
import { actorId, handle, fail } from '../utils/clinicAccess.js';
import { withAppointmentPaymentLock } from '../services/appointmentPaymentService.js';
import { emitAppointmentUpdated, emitResourceUpdated } from '../services/portalRealtimeService.js';
import { feeCurrency } from '../utils/consultationCurrency.js';
import { payoutsConfigured, bankFingerprint } from '../services/doctorSettlementService.js';
import ProviderPaymentSettings from '../models/providerPaymentSettingsModel.js';
import { commissionSnapshot } from '../services/appointmentCommissionService.js';
export { commissionSnapshot } from '../services/appointmentCommissionService.js';


// A unique appointment payment is the earnings ledger entry; retries reuse it.
export const payAppointmentInternally = handle(async (req, res) => {
  if (req.user.role !== 'user') throw fail(403, 'Only patients can pay for appointments.');
  if (req.body?.mode === 'demo') throw fail(403, 'Dummy payments have been removed. Use Razorpay Checkout in test mode.');
  if (paymentMode() === 'test') throw fail(409, 'Use Razorpay test card or UPI checkout. Existing wallet balances cannot fund test appointments.');
  const method = 'wallet';
  const result = await withAppointmentPaymentLock(req.params.appointmentId, async () => {
    const appointment = await Appointment.findOne({ _id: req.params.appointmentId, patient: actorId(req) });
    if (!appointment) throw fail(404, 'Appointment not found.');
    let record = await AppointmentPayment.findOne({ appointmentId: appointment._id });
    if (record && (record.mode !== 'real' || record.method !== method)) throw fail(409, 'A payment already exists using another method.');
    if (record?.orderId) throw fail(409, 'An online payment order already exists.');
    if (!record) {
      if (appointment.payment_status === 'paid' || !['pending', 'confirmed'].includes(appointment.status)) throw fail(409, 'This appointment cannot be paid.');
      const provider = await User.findById(appointment.counselor);
      if (!provider?.isActive) throw fail(404, 'Provider is unavailable.');
      if ((feeCurrency(provider) || 'INR') !== 'INR') throw fail(400, 'Wallet payments currently support INR only.');
      const clinic = appointment.clinic_id ? await Clinic.findById(appointment.clinic_id) : null;
      if (clinic && String(clinic.doctor_id) !== String(provider._id)) throw fail(400, 'Invalid provider clinic.');
      const fee = Number(clinic?.fee ?? clinic?.consultation_fee ?? clinic?.consultationFee ?? provider.consultationFee);
      const amount = Math.round((fee + appointmentAdditionalFee(appointment.consultation_mode, clinic, provider)) * 100);
      if (!Number.isSafeInteger(amount) || amount < 100) throw fail(400, 'Invalid consultation fee.');
      record = await AppointmentPayment.create({ appointmentId: appointment._id, userId: actorId(req), providerId: provider._id, method, mode: 'real', amount, ...commissionSnapshot(amount), paymentId: `wallet_${crypto.randomUUID()}` });
    }
    if (record.status !== 'paid') {
      const debit = await User.updateOne({ _id: actorId(req), walletBalance: { $gte: record.amount / 100 }, appointmentWalletDebitIds: { $ne: String(record._id) } }, { $inc: { walletBalance: -record.amount / 100 }, $addToSet: { appointmentWalletDebitIds: String(record._id) } });
      if (!debit.modifiedCount && !await User.exists({ _id: actorId(req), appointmentWalletDebitIds: String(record._id) })) throw fail(409, 'Insufficient wallet balance. Please add money and retry.');
    }
    await Transaction.findOneAndUpdate({ transactionId: `appointment_${record._id}` }, { $setOnInsert: {
      userId: actorId(req), counselorId: record.providerId, amount: record.amount / 100,
      currency: 'INR', type: 'debit', status: 'completed', paymentMethod: 'wallet',
      description: 'Appointment payment', metadata: { appointmentId: String(appointment._id) },
    } }, { upsert: true });
    await AppointmentPayment.updateOne({ _id: record._id }, { $set: { status: 'paid' } });
    await Appointment.updateOne({ _id: appointment._id }, { $set: { payment_status: 'paid', payment_method: method, payment_amount: record.amount / 100, payment_reference: record.paymentId } });
    emitAppointmentUpdated({ patient: actorId(req), counselor: record.providerId });
    emitResourceUpdated('wallet', [actorId(req), String(record.providerId)]);
    return { success: true, paid: true, mode: 'live', paymentId: record.paymentId, amount: record.amount / 100 };
  });
  res.json(result);
});

export function summarizeEarnings(records) {
  const summary = { pending: 0, available: 0, settled: 0, platformFees: 0, held: 0, processing: 0 };
  const transactions = records.map(record => {
    const appointment = record.appointmentId || {};
    const gross = Number(record.amount);
    const fee = Number(record.platformFee || 0);
    const net = gross - fee;
    const canceled = ['canceled', 'cancelled', 'rejected', 'no_show', 'no-show'].includes(appointment.status) || ['canceled', 'no_show'].includes(appointment.queue_status);
    const status = record.settlementStatus === 'completed' ? 'settled' : record.settlementStatus === 'processing' ? 'processing' : canceled || !appointment._id ? 'held' : appointment.status === 'completed' || appointment.queue_status === 'completed' ? 'available' : 'pending';
    summary[status] += net;
    if (['available', 'settled', 'processing'].includes(status)) summary.platformFees += fee;
    return { id: String(record._id), appointmentId: String(appointment._id || ''), patient: record.userId?.fullName || 'Patient', clinic: appointment.clinic_id?.clinic_name || 'Online', method: record.method, paymentId: record.paymentId, createdAt: record.createdAt, gross: gross / 100, platformFee: fee / 100, platformFeePercent: record.platformFeePercent, net: net / 100, status, payoutId: record.payoutId, payoutUtr: record.payoutUtr, payoutFailure: record.payoutFailure, settledAt: record.settledAt, payoutRequested: Boolean(record.payoutKey), currency: record.currency || 'INR' };
  });
  return { summary: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value / 100])), transactions };
}

export const getDoctorWallet = handle(async (req, res) => {
  if (!['doctor', 'counsellor', 'counselor'].includes(req.user.role)) throw fail(403, 'Provider account required.');
  const records = await AppointmentPayment.find({ providerId: actorId(req), status: 'paid' }).populate('appointmentId').populate('userId', 'fullName').sort({ createdAt: -1 }).lean();
  // Populate clinic names separately to retain support for the MySQL adapter.
  for (const record of records) {
    if (record.appointmentId?.clinic_id) record.appointmentId.clinic_id = await Clinic.findById(record.appointmentId.clinic_id).select('clinic_name').lean();
  }
  const fields = payoutBankFields();
  const settings = await ProviderPaymentSettings.findOne({ providerId: actorId(req) }).select(`+${fields.id} +${fields.fingerprint} +${fields.key}`);
  const bankReady = Boolean(settings?.[fields.id] && settings[fields.fingerprint] === bankFingerprint(settings.bankAccount) && settings[fields.key] === process.env.RAZORPAYX_KEY_ID);
  res.json({ success: true, mode: paymentMode(), platformFeePercent: 20, settlement: { enabled: payoutsConfigured(), bankReady, bankSaved: Boolean(settings?.bankAccount?.accountNumber) }, ...summarizeEarnings(records.filter(row => row.mode === paymentRecordMode())) });
});
