import mongoose from '../persistence/mongoose.js';

const notificationTokenSchema =
  new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
      },

      token: {
        type: String,
        required: true,
        unique: true,
      },

      platform: {
        type: String,
        enum: ['android', 'ios'],
        default: 'android',
      },

      active: {
        type: Boolean,
        default: true,
      },

      lastUpdatedAt: {
        type: Date,
        default: Date.now,
      },
    },
    {
      timestamps: true,
    },
  );

export default mongoose.model(
  'NotificationToken',
  notificationTokenSchema,
);