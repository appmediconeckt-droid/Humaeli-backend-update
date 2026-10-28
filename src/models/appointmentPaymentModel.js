import mongoose from '../persistence/mongoose.js';

const schema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: String, unique: true, sparse: true },
  paymentId: { type: String },
  method: { type: String, enum: ['credit_card', 'debit_card', 'upi', 'wallet'], required: true },
  mode: { type: String, enum: ['real', 'test', 'demo'], default: 'real' },
  gatewayKeyId: String,
  payoutKeyId: String,
  platformFee: { type: Number, default: 0 },
  platformFeePercent: { type: Number, default: 0 },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  settlementStatus: { type: String, default: 'pending_provider_settlement' },
  payoutId: String,
  payoutKey: String,
  payoutRequestedAt: Date,
  payoutPayload: { type: mongoose.Schema.Types.Mixed, select: false },
  payoutUtr: String,
  payoutFailure: String,
  settledAt: Date,
}, { timestamps: true });

export default mongoose.models.AppointmentPayment || mongoose.model('AppointmentPayment', schema);
