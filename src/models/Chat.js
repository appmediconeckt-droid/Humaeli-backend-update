import mongoose from '../persistence/mongoose.js';

const chatSchema = new mongoose.Schema({
  chatId: {
    type: String,
    unique: true,
    default: () => `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  counselorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'closed', 'active', 'cancelled', 'paused'],
    default: 'pending'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
   expiresAt: {
  type: Date,
  default: null
},
  cancelledAt: {
  type: Date,
  default: null
},
  sessionType: {
    type: String,
    enum: ['chat', 'voice', 'video'],
    default: 'chat'
  },
  amount: {
    type: Number,
    default: 0
  },
  paymentStatus: {
    type: String,
    enum: ['free', 'hold', 'paid', 'refunded', 'released'],
    default: 'free'
  },
  paymentTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  },
  paidSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatSession',
    default: null
  },
  acceptedAt: Date,
  rejectedAt: Date,
  closedAt: Date,
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastMessage: String,
  lastMessageAt: Date,
  deletedByUser: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedByCounselor: {
    type: Boolean,
    default: false,
    index: true
  },
  archivedByUser: {
    type: Boolean,
    default: false,
    index: true
  },
  archivedByCounselor: {
    type: Boolean,
    default: false,
    index: true
  },
  archivedByUserAt: {
    type: Date,
    default: null
  },
  archivedByCounselorAt: {
    type: Date,
    default: null
  }
});

// A user/counselor pair owns one durable conversation. Hiding it never
// deletes that conversation or its messages.
chatSchema.index({ userId: 1, counselorId: 1 }, { unique: true });

const Chat = mongoose.model('Chat', chatSchema);
export default Chat;
