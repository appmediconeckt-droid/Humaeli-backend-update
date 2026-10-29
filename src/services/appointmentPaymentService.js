import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import dotenv from 'dotenv';
import { getPool } from '../config/mysql.js';
import Appointment from '../models/appointmentModel.js';
import AppointmentPayment from '../models/appointmentPaymentModel.js';
import { fail } from '../utils/clinicAccess.js';
import { paymentMode, requireGatewayEnvironment, requireRecordEnvironment } from './paymentEnvironment.js';
import { confirmPaidAppointment } from './appointmentPaymentBookingService.js';
import { reclaimReleasedPaymentSlot } from './appointmentDraftSlotService.js';

dotenv.config();
export const appointmentGateway = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID || 'not-configured', key_secret: process.env.RAZORPAY_KEY_SECRET || 'not-configured' });
export const appointmentPaymentRepository = { connection: () => getPool().getConnection() };
export async function withAppointmentPaymentLock(id, action) {
  const connection = await appointmentPaymentRepository.connection();
  const key = 'appointment-pay:' + crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 40);
  let locked = false;
  try {
    const [rows] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [key]);
    locked = Number(rows[0]?.acquired) === 1;
    if (!locked) throw fail(503, 'Payment confirmation is busy. Please retry.');
    return await action();
  } finally {
    try { if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [key]); }
    finally { connection.release(); }
  }
}

export function requireAppointmentGateway() {
  requireGatewayEnvironment(process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET);
}

export async function validateCapturedAppointmentPayment(record, payment) {
  if (!payment || payment.status !== 'captured') throw fail(409, 'Payment capture is pending. Your appointment remains reserved; check payment again shortly.');
  if (String(payment.order_id) !== record.orderId || Number(payment.amount) !== record.amount || payment.currency !== record.currency) {
    throw fail(400, 'Payment does not match this appointment order.');
  }
  if (record.method === 'upi') {
    if (payment.method !== 'upi') throw fail(400, 'Pay using the selected UPI method.');
  } else {
    if (payment.method !== 'card') throw fail(400, 'Pay using the selected card method.');
    const card = payment.card || (payment.card_id ? await appointmentGateway.cards.fetch(payment.card_id) : null);
    if (card?.type !== (record.method === 'credit_card' ? 'credit' : 'debit')) throw fail(400, 'The card type does not match your selected payment method.');
  }
}

// This records a collected payment. Provider bank settlement is a separate step.
export async function completeAppointmentPayment(record, payment) {
  requireRecordEnvironment(record);
  await validateCapturedAppointmentPayment(record, payment);
  await reclaimReleasedPaymentSlot(record);
  if (record.status === 'paid' && record.paymentId !== payment.id) throw fail(409, 'This appointment has already been paid.');
  await AppointmentPayment.updateOne({ _id: record._id }, { $set: { status: 'paid', paymentId: payment.id } });
  await confirmPaidAppointment({ ...(record.toObject?.() || record), paymentId: payment.id });
  return { success: true, paid: true, paymentId: payment.id, amount: record.amount / 100, currency: record.currency, mode: paymentMode() };
}

export async function recoverAppointmentPayment(orderId) {
  const record = await AppointmentPayment.findOne({ orderId });
  if (!record) return null;
  return withAppointmentPaymentLock(record.appointmentId, async () => {
    const fresh = await AppointmentPayment.findById(record._id);
    requireRecordEnvironment(fresh);
    const result = await appointmentGateway.orders.fetchPayments(orderId);
    const payment = result?.items?.find((item) => item.status === 'captured');
    if (!payment) return { success: false, pending: true };
    return completeAppointmentPayment(fresh, payment);
  });
}

// Recover a lost browser callback/webhook before loading the patient's list.
// Only captured payments can promote a draft; failed attempts stay hidden.
export async function recoverPatientPaymentDrafts(userId) {
  const drafts = await Appointment.find({ patient: userId, status: 'awaiting_payment' }, null, { includePaymentDrafts: true })
    .select('_id').sort({ createdAt: -1 }).limit(5).lean();
  if (!drafts.length) return;
  const records = await AppointmentPayment.find({ userId, appointmentId: { $in: drafts.map(draft => draft._id) } }).lean();
  await Promise.allSettled(records.map(async record => {
    if (record.method === 'wallet') {
      if (record.mode === 'real' && record.status === 'paid') await confirmPaidAppointment(record);
    } else if (record.orderId) {
      requireRecordEnvironment(record);
      requireAppointmentGateway();
      await recoverAppointmentPayment(record.orderId);
    }
  }));
}
