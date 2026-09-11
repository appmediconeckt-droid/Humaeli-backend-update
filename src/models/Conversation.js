// models/Conversation.js
import mongoose from '../persistence/mongoose.js';

const conversationSchema = new mongoose.Schema({
  participants: {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    counsellor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  lastMessage: {
    type: String,
    default: ''
  },
  lastMessageTime: {
    type: Date,
    default: Date.now
  },
  lastMessageSender: {
    type: String,
    enum: ['user', 'counsellor'],
    default: null
  },
  unreadCount: {
    user: { type: Number, default: 0 },
    counsellor: { type: Number, default: 0 }
  },
  status: {
    type: String,
    enum: ['active', 'archived', 'blocked'],
    default: 'active'
  },
  archivedAt: Date
}, {
  timestamps: true
});

// Ensure unique conversation between user and counsellor
conversationSchema.index({ 'participants.user': 1, 'participants.counsellor': 1 }, { unique: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;