import mongoose from '../persistence/mongoose.js';

// Kept separately from public provider profiles so account numbers are private.
const schema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  methods: { type: [String], default: ['cash'] },
  bankAccount: {
    accountHolder: String, bankName: String, accountNumber: String, ifscCode: String,
  },
  upiId: { type: String, default: '' },
  upiApp: { type: String, enum: ['', 'phonepe', 'google_pay', 'paytm', 'bhim', 'other'], default: '' },
}, { timestamps: true });

export default mongoose.models.ProviderPaymentSettings || mongoose.model('ProviderPaymentSettings', schema);
