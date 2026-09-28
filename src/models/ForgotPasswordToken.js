// models/ForgotPasswordToken.js
import mongoose from '../persistence/mongoose.js';

const forgotPasswordTokenSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  otp: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  },
  isUsed: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for automatic cleanup
forgotPasswordTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Method to check if token is expired
forgotPasswordTokenSchema.methods.isExpired = function() {
  return this.expiresAt < new Date();
};

// Method to check if token is valid
forgotPasswordTokenSchema.methods.isValid = function() {
  return !this.isUsed && !this.isExpired();
};

const ForgotPasswordToken = mongoose.model('ForgotPasswordToken', forgotPasswordTokenSchema);

export default ForgotPasswordToken;