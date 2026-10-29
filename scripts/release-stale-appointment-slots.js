import dotenv from 'dotenv';
import storage, { connectMySQL } from '../src/persistence/mongoose.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import Appointment from '../src/models/appointmentModel.js';
import { releaseUnpaidAppointmentSlot } from '../src/controllers/appointmentPaymentController.js';
import { appointmentGateway } from '../src/services/appointmentPaymentService.js';

dotenv.config({ quiet: true });
const apply = process.argv.includes('--apply');
// Keep maintenance reads bounded and independent of local SDK proxy settings.
const readGateway = async path => {
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Object.assign(new Error('The gateway could not verify the original order.'), { statusCode: 503 });
  return response.json();
};
appointmentGateway.orders.fetch = id => readGateway(`orders/${encodeURIComponent(id)}`);
appointmentGateway.orders.fetchPayments = id => readGateway(`orders/${encodeURIComponent(id)}/payments`);
try {
  await connectMySQL(mysqlConfig());
  // Leave recent checkouts alone. Every older candidate is checked again
  // against its ledger/gateway under the existing payment lock before release.
  const drafts = await Appointment.find({
    status: 'awaiting_payment', queue_status: { $ne: 'canceled' },
    createdAt: { $lt: new Date(Date.now() - 15 * 60000) },
  }, null, { includePaymentDrafts: true }).lean();
  const summary = { candidates: drafts.length, released: 0, paid: 0, kept: 0, errors: 0, reasons: {}, apply };
  if (apply) for (const draft of drafts) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await releaseUnpaidAppointmentSlot({ user: { _id: draft.patient, role: 'user' }, params: { appointmentId: String(draft._id) } }, res);
    if (res.code >= 400) {
      summary.errors++;
      const reason = res.body?.message || `HTTP ${res.code}`;
      summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
    }
    else if (res.body?.released) summary.released++;
    else if (res.body?.paid) summary.paid++;
    else summary.kept++;
  }
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error('Slot repair failed:', error.code || error.name);
  process.exitCode = 1;
} finally {
  await storage.disconnect();
  // Payment locks use a separate shared pool with a keepalive timer.
  process.exit(process.exitCode || 0);
}
