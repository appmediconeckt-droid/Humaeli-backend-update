import mongoose from "../persistence/mongoose.js";
import Appointment from "../models/appointmentModel.js";
import Call from "../models/Call.js";
import Chat from "../models/Chat.js";
import ChatSession from "../models/ChatSession.js";
import Conversation from "../models/Conversation.js";
import ForgotPasswordToken from "../models/ForgotPasswordToken.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import OTP from "../models/otpModel.js";
import LoginOTP from "../models/loginOtpModel.js";
import Rating from "../models/Rating.js";
import RatingStatus from "../models/RatingStatus.js";
import RegistrationOTP from "../models/registrationOtpModel.js";
import Session from "../models/sessionModel.js";
import AIChat from "../models/chatModel.js";

const toObjectId = (value) => {
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

export const cleanupAccountData = async ({ userId, email } = {}) => {
  const objectId = toObjectId(userId);
  if (!objectId) {
    throw new Error("A valid userId is required for account cleanup");
  }

  const idFilter = { $in: [objectId, String(objectId)] };
  const chats = await Chat.find({
    $or: [{ userId: objectId }, { counselorId: objectId }],
  }).select("_id chatId paidSessionId");
  const chatObjectIds = chats.map((chat) => chat._id);
  const chatPublicIds = chats.map((chat) => chat.chatId).filter(Boolean);
  const paidSessionIds = chats.map((chat) => chat.paidSessionId).filter(Boolean);
  const messageChatIds = [...chatObjectIds, ...chatPublicIds];

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const cleanupTasks = [
    Appointment.deleteMany({ $or: [{ patient: objectId }, { counselor: objectId }] }),
    Call.deleteMany({
      $or: [{ callerId: objectId }, { receiverId: objectId }, { endedBy: objectId }],
    }),
    Notification.deleteMany({
      $or: [{ recipientId: objectId }, { actorId: objectId }],
    }),
    Session.deleteMany({ userId: objectId }),
    OTP.deleteMany({ userId: objectId }),
    LoginOTP.deleteMany({ userId: objectId }),
    AIChat.deleteMany({ userId: idFilter }),
    Conversation.deleteMany({
      $or: [
        { "participants.user": objectId },
        { "participants.counsellor": objectId },
      ],
    }),
    Rating.deleteMany({ $or: [{ userId: objectId }, { counselorId: objectId }] }),
    RatingStatus.deleteMany({ $or: [{ userId: objectId }, { counselorId: objectId }] }),
    ChatSession.deleteMany({
      $or: [
        { userId: objectId },
        { counselorId: objectId },
        ...(paidSessionIds.length ? [{ _id: { $in: paidSessionIds } }] : []),
      ],
    }),
  ];

  if (messageChatIds.length) {
    cleanupTasks.push(
      Message.deleteMany({
        $or: [
          { chatId: { $in: messageChatIds } },
          { senderId: objectId },
        ],
      }),
    );
  } else {
    cleanupTasks.push(Message.deleteMany({ senderId: objectId }));
  }

  cleanupTasks.push(Chat.deleteMany({ _id: { $in: chatObjectIds } }));

  if (normalizedEmail) {
    cleanupTasks.push(
      RegistrationOTP.deleteMany({ email: normalizedEmail }),
      ForgotPasswordToken.deleteMany({ email: normalizedEmail }),
    );
  }

  const results = await Promise.all(cleanupTasks);
  const summary = results.reduce((acc, result, index) => {
    acc.operations += 1;
    acc.deletedCount += Number(result?.deletedCount || 0);
    acc.modifiedCount += Number(result?.modifiedCount || 0);
    acc.acknowledged = acc.acknowledged && result?.acknowledged !== false;
    acc[`op${index + 1}`] = Number(result?.deletedCount || result?.modifiedCount || 0);
    return acc;
  }, {
    operations: 0,
    deletedCount: 0,
    modifiedCount: 0,
    acknowledged: true,
  });

  return {
    ...summary,
    chatCount: chatObjectIds.length,
    paymentHistoryPreserved: true,
  };
};

export default cleanupAccountData;
