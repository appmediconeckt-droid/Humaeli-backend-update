import crypto from 'node:crypto';
import { appointmentAdditionalFee } from '../services/appointmentFees.js';
import { reclaimReleasedPaymentSlot } from '../services/appointmentDraftSlotService.js';
import { emitAppointmentUpdated } from '../services/portalRealtimeService.js';
import { paymentMode, paymentRecordMode, requireRecordEnvironment } from '../services/paymentEnvironment.js';
import { commissionSnapshot } from '../services/appointmentCommissionService.js';
import Appointment from '../models/appointmentModel.js';
import User from '../models/userModel.js';
import { Clinic } from '../models/clinicModels.js';
import AppointmentPayment from '../models/appointmentPaymentModel.js';
import ProviderPaymentSettings from '../models/providerPaymentSettingsModel.js';
import { actorId, handle, fail } from '../utils/clinicAccess.js';
import { feeCurrency } from '../utils/consultationCurrency.js';
import { publicPaymentSettings } from '../services/providerPaymentSettingsService.js';
import { appointmentGateway, completeAppointmentPayment, requireAppointmentGateway, withAppointmentPaymentLock, recoverAppointmentPayment } from '../services/appointmentPaymentService.js';

const ownAppointment = async (req) => {
  if (req.user.role !== 'user') throw fail(403, 'Only patients can pay for their appointments.');
  const appointment = await Appointment.findOne({ _id: req.params.appointmentId, patient: actorId(req) }, null, { includePaymentDrafts: true });
  if (!appointment) throw fail(404, 'Appointment not found.');
  return appointment;
};

export const createAppointmentPaymentOrder = handle(async (req, res) => {
  requireAppointmentGateway();
  if (!['credit_card', 'debit_card', 'upi'].includes(req.body?.method)) throw fail(400, 'Select a supported online payment method.');
  const appointment = await ownAppointment(req);
  const result = await withAppointmentPaymentLock(appointment._id, async () => {
    const existing = await AppointmentPayment.findOne({ appointmentId: appointment._id });
    if (existing) requireRecordEnvironment(existing);
    if (existing && (existing.mode === 'demo' || existing.method === 'wallet')) throw fail(409, 'This appointment already has a wallet or demo payment.');
    if (!existing && appointment.payment_status === 'paid') throw fail(409, 'This appointment has already been paid.');
    if (existing?.status === 'paid') return completeAppointmentPayment(existing, await appointmentGateway.payments.fetch(existing.paymentId));
    if (['cancelled', 'canceled', 'rejected', 'completed', 'no-show', 'no_show'].includes(String(appointment.status).toLowerCase())) throw fail(409, 'This appointment can no longer be paid online.');
    if (existing?.orderId) {
      const payments = await appointmentGateway.orders.fetchPayments(existing.orderId);
      const captured = payments?.items?.find((item) => item.status === 'captured');
      if (captured) return completeAppointmentPayment(existing, captured);
      if (payments?.items?.some((item) => item.status === 'authorized')) throw fail(409, 'Payment capture is pending. Please check again shortly.');
      if (existing.method !== req.body.method) throw fail(409, 'Retry using the payment method selected for this reserved appointment.');
      await reclaimReleasedPaymentSlot(existing);
      return orderResponse(existing);
    }
    const provider = await User.findById(appointment.counselor);
    if (!provider || !provider.isActive) throw fail(404, 'Provider is unavailable.');
    const settings = await ProviderPaymentSettings.findOne({ providerId: provider._id }).lean();
    const method = req.body.method;
    if (!['credit_card', 'debit_card', 'upi'].includes(method) || !publicPaymentSettings(provider, settings).methods.includes(method)) {
      throw fail(400, 'Select an online payment method enabled by this provider.');
    }
    const currency = feeCurrency(provider) || 'INR';
    if (currency !== 'INR') throw fail(400, 'Online appointment payments currently support INR fees only.');
    const clinic = appointment.clinic_id ? await Clinic.findById(appointment.clinic_id) : null;
    if (clinic && String(clinic.doctor_id) !== String(provider._id)) throw fail(400, 'Clinic does not belong to this provider.');
    const fee = Number(clinic?.fee ?? clinic?.consultation_fee ?? clinic?.consultationFee ?? provider.consultationFee);
    const surcharge = appointmentAdditionalFee(appointment.consultation_mode, clinic, provider);
    const amount = Math.round((fee + surcharge) * 100);
    if (!Number.isSafeInteger(amount) || amount < 100) throw fail(400, 'This provider has no valid online consultation fee configured.');
    if (appointment.queue_status === 'canceled' && appointment.status === 'awaiting_payment') {
      await reclaimReleasedPaymentSlot({ appointmentId: appointment._id, userId: actorId(req), slotReleased: true });
    }
    const order = await appointmentGateway.orders.create({ amount, currency, receipt: `appt_${String(appointment._id)}`, notes: { appointmentId: String(appointment._id) } });
    const record = await AppointmentPayment.create({ appointmentId: appointment._id, userId: actorId(req), providerId: provider._id, orderId: order.id, amount, currency, method, mode: paymentRecordMode(), gatewayKeyId: process.env.RAZORPAY_KEY_ID, ...commissionSnapshot(amount) });
    return orderResponse(record);
  });
  res.json(result);
});

function orderResponse(record) {
  return { success: true, order_id: record.orderId, amount: record.amount, currency: record.currency, method: record.method, key_id: process.env.RAZORPAY_KEY_ID, mode: paymentMode() };
}

export const verifyAppointmentPayment = handle(async (req, res) => {
  requireAppointmentGateway();
  const appointment = await ownAppointment(req);
  const record = await AppointmentPayment.findOne({ appointmentId: appointment._id, userId: actorId(req) });
  if (record) requireRecordEnvironment(record);
  const { razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (!record || record.orderId !== req.body.razorpay_order_id || typeof paymentId !== 'string' || !/^[a-f0-9]{64}$/i.test(String(signature || ''))) throw fail(400, 'Valid payment details are required.');
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${record.orderId}|${paymentId}`).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw fail(400, 'Invalid payment signature.');
  const result = await withAppointmentPaymentLock(appointment._id, async () => {
    const fresh = await AppointmentPayment.findById(record._id);
    const payment = await appointmentGateway.payments.fetch(paymentId);
    return completeAppointmentPayment(fresh, payment);
  });
  res.json(result);
});

export const reconcileAppointmentPayment = handle(async (req, res) => {
  requireAppointmentGateway();
  const appointment = await ownAppointment(req);
  const record = await AppointmentPayment.findOne({ appointmentId: appointment._id, userId: actorId(req) });
  if (!record?.orderId) throw fail(404, 'No payment order exists for this appointment.');
  const result = await recoverAppointmentPayment(record.orderId);
  res.status(result?.paid ? 200 : 202).json(result);
});

export const releaseUnpaidAppointmentSlot = handle(async (req, res) => {
  const appointment = await ownAppointment(req);
  const result = await withAppointmentPaymentLock(appointment._id, async () => {
    if (appointment.status !== 'awaiting_payment' || appointment.payment_status === 'paid') return { released: false };
    const record = await AppointmentPayment.findOne({ appointmentId: appointment._id, userId: actorId(req) });
    if (record) {
      const changedKey = record.gatewayKeyId && record.gatewayKeyId !== process.env.RAZORPAY_KEY_ID;
      if (changedKey && record.orderId && record.status !== 'paid') {
        // Keys can be rotated within a merchant account. Only release an old
        // draft if the current credentials can read and identify its order.
        requireRecordEnvironment({ ...(record.toObject?.() || record), gatewayKeyId: undefined });
        requireAppointmentGateway();
        const order = await appointmentGateway.orders.fetch(record.orderId);
        if (order.id !== record.orderId || Number(order.amount) !== record.amount || order.currency !== record.currency ||
            String(order.notes?.appointmentId) !== String(appointment._id)) {
          throw fail(409, 'The original payment order could not be verified.');
        }
      } else requireRecordEnvironment(record);
      if (record.status === 'paid') return { released: false, pending: true };
      if (record.method === 'wallet' && await User.exists({ _id: actorId(req), appointmentWalletDebitIds: String(record._id) })) return { released: false, pending: true };
      if (record.orderId) {
        requireAppointmentGateway();
        const payments = await appointmentGateway.orders.fetchPayments(record.orderId);
        const captured = payments?.items?.find(item => item.status === 'captured');
        if (captured) return completeAppointmentPayment(record, captured);
        if (payments?.items?.some(item => item.status === 'authorized')) return { released: false, pending: true };
      }
      // Persist this first so a delayed success knows it must recheck occupancy.
      await AppointmentPayment.updateOne({ _id: record._id }, { $set: { slotReleased: true } });
    }
    await Appointment.updateOne({ _id: appointment._id, patient: actorId(req), status: 'awaiting_payment', payment_status: { $ne: 'paid' } }, {
      $set: { queue_status: 'canceled' }, $unset: { slot_key: 1 },
    });
    emitAppointmentUpdated(appointment);
    return { released: true, paid: false };
  });
  res.json(result);
});
