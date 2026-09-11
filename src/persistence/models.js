// Explicit imports work in both Node and serverless bundles.
export async function loadModels() {
  await import('../models/userModel.js');
  await import('../models/appointmentModel.js');
  await import('../models/Call.js');
  await import('../models/Chat.js');
  await import('../models/chatModel.js');
  await import('../models/ChatSession.js');
  await import('../models/Conversation.js');
  await import('../models/CounselorEarning.js');
  await import('../models/CounselorOnlineSubscription.js');
  await import('../models/ForgotPasswordToken.js');
  await import('../models/loginOtpModel.js');
  await import('../models/Message.js');
  await import('../models/Notification.js');
  await import('../models/NotificationToken.js');
  await import('../models/otpModel.js');
  await import('../models/Prescription.js');
  await import('../models/Rating.js');
  await import('../models/RatingStatus.js');
  await import('../models/refreshTokenModel.js');
  await import('../models/registrationOtpModel.js');
  await import('../models/sessionModel.js');
  await import('../models/transactionModel.js');
  await import('../admin/models/AuditLog.js');
  await import('../admin/models/NotificationDelivery.js');
  await import('../admin/models/NotificationRule.js');
  await import('../admin/models/Payout.js');
  await import('../admin/models/Review.js');
  await import('../admin/models/Settings.js');
  await import('../admin/models/SupportTicket.js');
}
