import mongoose from '../persistence/mongoose.js';

const schema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: String, unique: true, sparse: true },
  paymentId: { type: String },
  method: { type: String, enum: ['credit_card', 'debit_card', 'upi'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  settlementStatus: { type: String, default: 'pending_provider_settlement' },
}, { timestamps: true });

export default mongoose.models.AppointmentPayment || mongoose.model('AppointmentPayment', schema);
