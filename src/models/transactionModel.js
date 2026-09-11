import mongoose from '../persistence/mongoose.js';

const transactionSchema = new mongoose.Schema({
    transactionId: { type: String, unique: true, sparse: true },
    paymentMethod: { type: String },
    platformFee: { type: Number, default: 0 },
    counselorEarnings: { type: Number, default: 0 },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    razorpayOrderId: {
        type: String
    },
    razorpayPaymentId: {
        type: String,
        index: true
    },
    razorpaySignature: {
        type: String
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'INR'
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'hold', 'refunded'],
        default: 'pending'
    },
    description: {
        type: String,
        default: 'Wallet Top-up'
    },
    type: {
        type: String,
        enum: ['credit', 'debit', 'refund'],
        default: 'credit'
    },
    counselorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chat'
    },
    sessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatSession'
    },
    relatedTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction'
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
