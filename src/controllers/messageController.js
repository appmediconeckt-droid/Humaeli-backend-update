import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/userModel.js";
import { createNotificationSafely } from "../services/notificationService.js";
import {
  activatePaidSession,
  startTimedChatUsage,
  stopTimedChatUsage,
  requestTimedChatStop,
  recordTimedChatActivity,
  touchTimedChatUsage,
  completePaidSession,
  createPaidSessionHold,
  expirePendingPaidChatRequests,
  getPaidSessionConfig,
  getRequestExpiryDate,
  getSessionAmount,
  isPaidSessionsEnabled,
  refundPaidSession,
} from "../services/paidSessionService.js";

const handleTimedChatUsage = (action) => async (req, res) => {
  try {
    const chat = await findChatByIdentifier(req.params.chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (String(chat.userId) !== String(req.user._id)) {
      return res.status(403).json({ error: "Only the user can update chat billing" });
    }
    const billing =
      action === "start"
        ? await startTimedChatUsage(chat)
        : action === "heartbeat"
          ? await touchTimedChatUsage(chat)
          : await requestTimedChatStop(chat);
    res.json({ success: true, billing });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Unable to update chat billing",
      walletBalance: error.walletBalance,
      requiredAmount: error.requiredAmount,
    });
  }
};

export const startChatUsage = handleTimedChatUsage("start");
export const stopChatUsage = handleTimedChatUsage("stop");
export const touchChatUsage = handleTimedChatUsage("heartbeat");

// ==================== HELPER FUNCTION ====================

// Helper function to find chat by either _id or chatId
const findChatByIdentifier = async (identifier) => {
  // Check if it's a valid ObjectId
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const chat = await Chat.findById(identifier);
    if (chat) return chat;
  }

  // Try to find by chatId field
  return await Chat.findOne({ chatId: identifier });
};

const visibleMessageFilter = (userId) => ({
  deletedFor: { $ne: userId },
});

const restoreChatForBothParticipants = (chat) => {
  const wasRestored = Boolean(
    chat.deletedByUser ||
      chat.deletedByCounselor ||
      (!chat.isActive && ["accepted", "active"].includes(chat.status)),
  );
  chat.deletedByUser = false;
  chat.deletedByCounselor = false;
  // Repairs conversations hidden by the legacy shared-delete behavior.
  if (["accepted", "active"].includes(chat.status)) {
    chat.isActive = true;
  }
  return wasRestored;
};

const visibleCounselorFilter = {
  role: "counsellor",
  isActive: true,
  profileCompleted: true,
  "specialization.0": { $exists: true },
  experience: { $gt: 0 },
  $and: [
    {
      $or: [
        { qualification: { $nin: ["", null] } },
        { education: { $nin: ["", null] } },
      ],
    },
  ],
};

const assertSufficientChatBalance = async (userId, sessionType) => {
  if (!isPaidSessionsEnabled()) return;

  const amount = getSessionAmount(sessionType);
  const user = await User.findById(userId).select("walletBalance");
  const requiredAmount =
    sessionType === "chat" ? Number((amount / 30).toFixed(2)) : amount;
  if ((user?.walletBalance || 0) < requiredAmount) {
    const error = new Error("Insufficient wallet balance");
    error.statusCode = 402;
    error.requiredAmount = requiredAmount;
    error.walletBalance = user?.walletBalance || 0;
    throw error;
  }
};

export const startChat = async (req, res) => {
  try {
    const { counselorId } = req.body;
    const sessionType = ["chat", "voice", "video"].includes(req.body?.sessionType)
      ? req.body.sessionType
      : "chat";

    if (req.user.role !== "user") {
      return res
        .status(403)
        .json({ error: "Only users can request chats with counselors" });
    }

    // console.log("User ID:", req.user._id);
    // console.log("Counselor ID:", counselorId);

    // Check if counselor exists
    const counselor = await User.findOne({
      _id: counselorId,
      ...visibleCounselorFilter,
    });

    if (!counselor) {
      return res.status(404).json({ error: "Counselor not found" });
    }

    // Check if admin has blocked this counselor from chatting
    if (counselor.chatPermission?.enabled === false) {
      return res.status(403).json({
        error: "This counselor is currently unavailable for chat.",
        reason: counselor.chatPermission.disabledReason || "admin_decision",
      });
    }

    // Check for existing chat
    let existingChat = await Chat.findOne({
      userId: req.user._id,
      counselorId: counselorId,
    });

    // If chat exists, handle it
    if (existingChat) {
      // Opening a known conversation from an appointment/profile restores it
      // for the requesting user without creating a duplicate conversation.
      if (existingChat.deletedByUser) {
        existingChat.deletedByUser = false;
        existingChat.updatedAt = new Date();
        await existingChat.save();
      }

      // Check if chat is in a state that allows reactivation
      const canReactivate =
        existingChat.status === "cancelled" ||
        existingChat.status === "rejected" ||
        existingChat.status === "closed" ||
        !existingChat.isActive;

      // Check if there's an active pending request
      if (existingChat.status === "pending" && existingChat.isActive) {
        // Active pending request exists
        const populatedChat = await Chat.findById(existingChat._id)
          .populate("userId", "fullName email profilePhoto anonymous")
          .populate(
            "counselorId",
            "fullName specialization profilePhoto rating isActive",
          );

        return res.status(400).json({
          error: `Chat request already active. Please wait for counselor to respond.`,
          status: existingChat.status,
          chatId: existingChat._id,
        });
      }

      // If chat is accepted or active, return error
      if (
        existingChat.status === "accepted" ||
        existingChat.status === "active"
      ) {
        const populatedChat = await Chat.findById(existingChat._id)
          .populate("userId", "fullName email profilePhoto anonymous")
          .populate(
            "counselorId",
            "fullName specialization profilePhoto rating isActive",
          );

        return res.status(200).json({
          success: true,
          message: "Existing chat restored",
          status: existingChat.status,
          chatId: existingChat._id,
          chat: {
            id: populatedChat._id,
            chatId: populatedChat.chatId,
            status: populatedChat.status,
            user: populatedChat.userId,
            counselor: populatedChat.counselorId,
          },
        });
      }

      // For cancelled, rejected, closed, or inactive chats, reactivate
      if (canReactivate) {
        await assertSufficientChatBalance(req.user._id, sessionType);
        console.log("Reactivating chat from status:", existingChat.status);

        // Reset the chat for new request
        existingChat.status = "pending";
        existingChat.isActive = true;
        existingChat.rejectedAt = null;
        existingChat.closedAt = null;
        existingChat.cancelledAt = null;
        existingChat.acceptedAt = null;
        existingChat.expiresAt = isPaidSessionsEnabled() ? getRequestExpiryDate() : null;
        existingChat.sessionType = sessionType;

        existingChat.updatedAt = new Date();
        await existingChat.save();

        const paidHold = await createPaidSessionHold({
          userId: req.user._id,
          counselorId,
          chat: existingChat,
          sessionType,
        });

        // Add new request message
        await Message.create({
          chatId: existingChat._id,
          senderId: req.user._id,
          senderRole: "user",
          content: `👋 I'd like to start a conversation.`,
          contentType: "TEXT",
        });
        await createNotificationSafely({
          recipientId: counselorId,
          actorId: req.user._id,
          type: "message",
          title: "New chat request",
          message: `${req.user.fullName || "A user"} wants to start a conversation.`,
          data: { chatId: existingChat._id, publicChatId: existingChat.chatId, request: true },
          actionUrl: `/chat/${existingChat._id}`,
        });

        const populatedChat = await Chat.findById(existingChat._id)
          .populate("userId", "fullName email profilePhoto anonymous")
          .populate(
            "counselorId",
            "fullName specialization profilePhoto rating isActive",
          );

        return res.json({
          success: true,
          message: "Chat request sent successfully",
          chat: {
            id: populatedChat._id,
            chatId: populatedChat.chatId,
            status: populatedChat.status,
            counselor: {
              id: populatedChat.counselorId._id,
              name: populatedChat.counselorId.fullName,
              specialization: populatedChat.counselorId.specialization,
              avatar: populatedChat.counselorId.profilePhoto?.url || null,
            },
            user: {
              id: populatedChat.userId._id,
              name: populatedChat.userId.fullName,
              anonymous: populatedChat.userId.anonymous,
              email: populatedChat.userId.email,
            },
            startedAt: populatedChat.startedAt,
            paymentStatus: populatedChat.paymentStatus,
            amount: populatedChat.amount,
            paidMode: isPaidSessionsEnabled(),
            walletBalance: paidHold?.walletBalance,
          },
        });
      }
    }

    // ONLY create new chat if NO existing chat exists
    console.log("No existing chat found, creating brand new chat");
    await assertSufficientChatBalance(req.user._id, sessionType);

    const chat = await Chat.create({
      userId: req.user._id,
      counselorId: counselorId,
      status: "pending",
      sessionType,
      expiresAt: isPaidSessionsEnabled() ? getRequestExpiryDate() : null,
      startedAt: new Date(),
      updatedAt: new Date(),
    });

    const paidHold = await createPaidSessionHold({
      userId: req.user._id,
      counselorId,
      chat,
      sessionType,
    });

    // Add request message
    await Message.create({
      chatId: chat._id,
      senderId: req.user._id,
      senderRole: "user",
      content: `👋 Hello! I'd like to start a conversation with you.`,
      contentType: "TEXT",
    });
    await createNotificationSafely({
      recipientId: counselorId,
      actorId: req.user._id,
      type: "message",
      title: "New chat request",
      message: `${req.user.fullName || "A user"} wants to start a conversation.`,
      data: { chatId: chat._id, publicChatId: chat.chatId, request: true },
      actionUrl: `/chat/${chat._id}`,
    });

    const populatedChat = await Chat.findById(chat._id)
      .populate("userId", "fullName email profilePhoto anonymous")
      .populate(
        "counselorId",
        "fullName specialization profilePhoto rating isActive",
      );

    res.json({
      success: true,
      chat: {
        id: populatedChat._id,
        chatId: populatedChat.chatId,
        status: populatedChat.status,
        expiresAt: populatedChat.expiresAt,
        counselor: {
          id: populatedChat.counselorId._id,
          name: populatedChat.counselorId.fullName,
          specialization: populatedChat.counselorId.specialization,
          avatar: populatedChat.counselorId.profilePhoto?.url || null,
        },
        user: {
          id: populatedChat.userId._id,
          name: populatedChat.userId.fullName,
          anonymous: populatedChat.userId.anonymous,
          email: populatedChat.userId.email,
        },
        startedAt: populatedChat.startedAt,
        paymentStatus: populatedChat.paymentStatus,
        amount: populatedChat.amount,
        paidMode: isPaidSessionsEnabled(),
        walletBalance: paidHold?.walletBalance,
      },
    });
  } catch (error) {
    console.error("Error starting chat:", error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
        requiredAmount: error.requiredAmount,
        walletBalance: error.walletBalance,
        paidMode: isPaidSessionsEnabled(),
      });
    }

    // Handle duplicate key error by finding and reactivating the existing chat
    if (error.code === 11000) {
      console.log(
        "Duplicate key error, attempting to reactivate existing chat",
      );

      const existingChat = await Chat.findOne({
        userId: req.user._id,
        counselorId: req.body.counselorId,
      });

      if (existingChat) {
        // Reactivate the existing chat
        console.log("Found existing chat, reactivating...");

        existingChat.status = "pending";
        existingChat.isActive = true;
        existingChat.rejectedAt = null;
        existingChat.closedAt = null;
        existingChat.cancelledAt = null;
        existingChat.acceptedAt = null;
        existingChat.expiresAt = isPaidSessionsEnabled() ? getRequestExpiryDate() : null;

        existingChat.updatedAt = new Date();
        await existingChat.save();

        const paidHold = await createPaidSessionHold({
          userId: req.user._id,
          counselorId: req.body.counselorId,
          chat: existingChat,
          sessionType: req.body?.sessionType || "chat",
        });

        // Add new request message
        await Message.create({
          chatId: existingChat._id,
          senderId: req.user._id,
          senderRole: "user",
          content: `🔄 Sending a new request.`,
          contentType: "TEXT",
        });
        await createNotificationSafely({
          recipientId: req.body.counselorId,
          actorId: req.user._id,
          type: "message",
          title: "New chat request",
          message: `${req.user.fullName || "A user"} sent a new chat request.`,
          data: { chatId: existingChat._id, publicChatId: existingChat.chatId, request: true },
          actionUrl: `/chat/${existingChat._id}`,
        });

        const populatedChat = await Chat.findById(existingChat._id)
          .populate("userId", "fullName email profilePhoto anonymous")
          .populate(
            "counselorId",
            "fullName specialization profilePhoto rating isActive",
          );

        return res.json({
          success: true,
          message: "Request sent successfully",
          chat: {
            id: populatedChat._id,
            chatId: populatedChat.chatId,
            status: populatedChat.status,
            counselor: {
              id: populatedChat.counselorId._id,
              name: populatedChat.counselorId.fullName,
              specialization: populatedChat.counselorId.specialization,
              avatar: populatedChat.counselorId.profilePhoto?.url || null,
            },
            user: {
              id: populatedChat.userId._id,
              name: populatedChat.userId.fullName,
              anonymous: populatedChat.userId.anonymous,
              email: populatedChat.userId.email,
            },
            startedAt: populatedChat.startedAt,
            paymentStatus: populatedChat.paymentStatus,
            amount: populatedChat.amount,
            paidMode: isPaidSessionsEnabled(),
            walletBalance: paidHold?.walletBalance,
          },
        });
      }
    }

    res.status(500).json({ error: "Error starting chat" });
  }
};

// Accept chat request (counselor only)
export const acceptChat = async (req, res) => {
  try {
    const { chatId } = req.params;

    console.log("Accepting chat with identifier:", chatId);

    // Use helper function to find chat by either _id or chatId
    const chat = await findChatByIdentifier(chatId);

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    console.log("Found chat:", {
      id: chat._id,
      chatId: chat.chatId,
      status: chat.status,
      counselorId: chat.counselorId,
      expiresAt: chat.expiresAt,
      isActive: chat.isActive,
    });

    // Check if admin has blocked this counselor from chatting
    const counselorUser = await User.findById(chat.counselorId).lean();
    if (counselorUser?.chatPermission?.enabled === false) {
      return res.status(403).json({
        error: "Chat access has been restricted by admin.",
        reason: counselorUser.chatPermission.disabledReason || "admin_decision",
      });
    }

    // Check if counselor is authorized
    if (
      req.user.role !== "counsellor" ||
      chat.counselorId.toString() !== req.user._id.toString()
    ) {
      return res
        .status(403)
        .json({ error: "Only the assigned counselor can accept this chat" });
    }

    // Check if chat is cancelled (expired)
    if (chat.status === "cancelled") {
      return res.status(400).json({
        error:
          "This chat request has expired. The user needs to send a new request.",
        status: "expired",
        canResend: true,
        chatId: chat._id,
      });
    }


    // Check if chat is pending
    if (chat.status !== "pending") {
      return res.status(400).json({
        error: `Cannot accept chat. Current status: ${chat.status}`,
        status: chat.status,
      });
    }

    // Accept the chat
    chat.status = "accepted";
    chat.acceptedAt = new Date();
    chat.updatedAt = new Date();
    await chat.save();
    await activatePaidSession(chat);

    // Add acceptance message
    const acceptMsg = await Message.create({
      chatId: chat._id,
      senderId: req.user._id,
      senderRole: "counsellor",
      content: `✅ I've accepted your request. How can I help you today?`,
      contentType: "TEXT",
    });

    // Get populated chat details
    const populatedChat = await Chat.findById(chat._id)
      .populate("userId", "fullName email profilePhoto isActive")
      .populate(
        "counselorId",
        "fullName specialization profilePhoto rating isActive",
      );

    await createNotificationSafely({
      recipientId: chat.userId,
      actorId: req.user._id,
      type: "message",
      title: "Chat request accepted",
      message: `${populatedChat.counselorId?.fullName || "Your counselor"} accepted your chat request.`,
      data: {
        chatId: chat._id,
        publicChatId: chat.chatId,
        accepted: true,
        counselorId: chat.counselorId,
      },
      actionUrl: `/chat/${chat._id}`,
    });

    // Get messages
    const messages = await Message.find({
      chatId: chat._id,
      ...visibleMessageFilter(req.user._id),
    }).sort({
      createdAt: 1,
    });

    // ✅ Emit real-time events
    if (global.io) {
      const chatRoom = `chat_${chat.chatId}`;
      // Notify user that chat was accepted
      global.io.to(`user_${chat.userId}`).emit("chat-status-update", {
        chatId: chat._id,
        status: "accepted",
        acceptedAt: chat.acceptedAt,
      });
      // Emit the acceptance message into the chat room
      global.io.to(chatRoom).emit("new-message", {
        id: acceptMsg._id,
        messageId: acceptMsg.messageId,
        chatId: chat._id,
        content: acceptMsg.content,
        senderRole: acceptMsg.senderRole,
        senderId: req.user._id,
        contentType: acceptMsg.contentType,
        createdAt: acceptMsg.createdAt,
        isRead: acceptMsg.isRead,
      });
    }

    res.json({
      success: true,
      message: "Chat request accepted",
      chat: {
        id: populatedChat._id,
        chatId: populatedChat.chatId,
        status: populatedChat.status,
        acceptedAt: populatedChat.acceptedAt,
        paymentStatus: populatedChat.paymentStatus,
        amount: populatedChat.amount,
        user: {
          id: populatedChat.userId._id,
          name: populatedChat.userId.fullName,
          anonymous: populatedChat.userId.anonymous,
          email: populatedChat.userId.email,
          avatar: populatedChat.userId.profilePhoto?.url || null,
          isOnline: populatedChat.userId.isActive,
        },
        counselor: {
          id: populatedChat.counselorId._id,
          name: populatedChat.counselorId.fullName,
          specialization: populatedChat.counselorId.specialization,
          avatar: populatedChat.counselorId.profilePhoto?.url || null,
          rating: populatedChat.counselorId.rating,
          isOnline: populatedChat.counselorId.isActive,
        },
        messages: messages.map((msg) => ({
          id: msg._id,
          messageId: msg.messageId,
          content: msg.content,
          senderRole: msg.senderRole,
          contentType: msg.contentType,
          createdAt: msg.createdAt,
          isRead: msg.isRead,
        })),
        startedAt: populatedChat.startedAt,
      },
    });
  } catch (error) {
    console.error("Error accepting chat:", error);
    res.status(500).json({ error: "Error accepting chat" });
  }
};

// Placeholder: Background job removed - requests no longer expire automatically
export const cancelExpiredRequests = async () => {
  return expirePendingPaidChatRequests();
};

// Reject chat request (counselor only)
export const rejectChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { reason } = req.body;

    console.log("Rejecting chat with identifier:", chatId);

    // Use helper function to find chat by either _id or chatId
    const chat = await findChatByIdentifier(chatId);

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Check if counselor is authorized
    if (
      req.user.role !== "counsellor" ||
      chat.counselorId.toString() !== req.user._id.toString()
    ) {
      return res
        .status(403)
        .json({ error: "Only the assigned counselor can reject this chat" });
    }

    if (chat.status !== "pending") {
      return res.status(400).json({ error: `Chat is already ${chat.status}` });
    }

    // Reject the chat
    chat.status = "rejected";
    chat.rejectedAt = new Date();
    chat.updatedAt = new Date();
    await chat.save();
    await refundPaidSession(chat, "counselor_rejected");

    // Add rejection message
    const rejectMsg = await Message.create({
      chatId: chat._id,
      senderId: req.user._id,
      senderRole: "counsellor",
      content: `❌ I'm currently unavailable. ${reason ? `Reason: ${reason}` : "Please try again later."}`,
      contentType: "TEXT",
    });

    // ✅ Emit real-time events
    if (global.io) {
      const chatRoom = `chat_${chat.chatId}`;
      global.io.to(`user_${chat.userId}`).emit("chat-status-update", {
        chatId: chat._id,
        status: "rejected",
        rejectedAt: chat.rejectedAt,
      });
      global.io.to(chatRoom).emit("new-message", {
        id: rejectMsg._id,
        messageId: rejectMsg.messageId,
        chatId: chat._id,
        content: rejectMsg.content,
        senderRole: rejectMsg.senderRole,
        senderId: req.user._id,
        contentType: rejectMsg.contentType,
        createdAt: rejectMsg.createdAt,
        isRead: rejectMsg.isRead,
      });
    }

    res.json({
      success: true,
      message: "Chat request rejected",
      chat: {
        id: chat._id,
        chatId: chat.chatId,
        status: chat.status,
        rejectedAt: chat.rejectedAt,
        paymentStatus: chat.paymentStatus,
        amount: chat.amount,
      },
    });
  } catch (error) {
    console.error("Error rejecting chat:", error);
    res.status(500).json({ error: "Error rejecting chat" });
  }
};

// Get pending chat requests (counselor only) - Filter out expired requests
export const getPendingRequests = async (req, res) => {
  try {
    if (req.user.role !== "counsellor") {
      return res
        .status(403)
        .json({ error: "Only counselors can view pending requests" });
    }

    const counselorId = req.user._id;
    const now = new Date();
    await expirePendingPaidChatRequests();

    // 1. Fetch all pending chats for this counselor
    const pendingChats = await Chat.find({
      counselorId,
      status: "pending",
      isActive: true,
      $or: [
        { expiresAt: null },
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: now } },
      ],
    })
      .populate("userId", "fullName email profilePhoto anonymous")
      .sort({ startedAt: -1 })
      .lean();

    const validPendingChats = pendingChats.filter((chat) => chat.userId);

    if (!validPendingChats.length) {
      return res.json({ requests: [] });
    }

    // 2. Optimized: Bulk fetch the FIRST message for all found chats in one query
    const chatIds = validPendingChats.map((c) => c._id);
    const messages = await Message.find({
      chatId: { $in: chatIds },
      senderRole: "user",
    })
      .sort({ createdAt: 1 })
      .lean();

    // Create a map for O(1) lookup
    const messageMap = {};
    messages.forEach((msg) => {
      // Since we sorted by createdAt: 1, the first message encountered for a chatId is the oldest
      if (!messageMap[msg.chatId.toString()]) {
        messageMap[msg.chatId.toString()] = msg.content;
      }
    });

    // 3. Construct the response
    const requests = validPendingChats.map((chat) => {
      const user = chat.userId || {};
      return {
        id: chat._id,
        chatId: chat.chatId,
        user: {
          id: user._id || null,
          name: user.fullName || "Unknown User",
          anonymous: user.anonymous || "",
          email: user.email || "",
          Image: user.profilePhoto?.url || null,
        },
        requestMessage: messageMap[chat._id.toString()] || "No message",
        requestedAt: chat.startedAt,
        expiresAt: chat.expiresAt,
        status: chat.status,
        paymentStatus: chat.paymentStatus,
        amount: chat.amount,
      };
    });

    res.json({ requests });
  } catch (error) {
    console.error("Error fetching pending requests:", error);
    res.status(500).json({ error: "Error fetching pending requests" });
  }
};

// Get all chats for current user/counselor
export const getChats = async (req, res) => {
  try {
    let chats;
    let query = {
      status: { $in: ["accepted", "active"] },
    };

    if (req.user.role === "user") {
      query.userId = req.user._id;
      query.deletedByUser = { $ne: true };
    } else if (req.user.role === "counsellor") {
      query.counselorId = req.user._id;
      query.deletedByCounselor = { $ne: true };
    } else {
      return res.status(403).json({ error: "Invalid user role" });
    }

    chats = await Chat.find(query)
      .populate(
        "userId",
        "fullName email profilePhoto anonymous age gender dateOfBirth isActive isOnline lastSeen",
      )
      .populate(
        "counselorId",
        "fullName specialization profilePhoto rating isActive isOnline lastSeen",
      )
      .sort({ updatedAt: -1 });

    const chatsWithDetails = await Promise.all(
      chats.map(async (chat) => {
        const lastMessage = await Message.findOne({
          chatId: chat._id,
          ...visibleMessageFilter(req.user._id),
        }).sort({
          createdAt: -1,
        });

        let unreadCount = 0;
        if (req.user.role === "user") {
          unreadCount = await Message.countDocuments({
            chatId: chat._id,
            senderRole: "counsellor",
            isRead: false,
            ...visibleMessageFilter(req.user._id),
          });
        } else {
          unreadCount = await Message.countDocuments({
            chatId: chat._id,
            senderRole: "user",
            isRead: false,
            ...visibleMessageFilter(req.user._id),
          });
        }

        const otherParty =
          req.user.role === "user" ? chat.counselorId : chat.userId;

        // A referenced user/counsellor can be missing (deleted/deactivated record).
        // Skip orphaned chats instead of crashing on otherParty._id.
        if (!otherParty) {
          console.warn(
            `Skipping orphaned chat ${chat._id}: missing ${req.user.role === "user" ? "counselorId" : "userId"} reference`,
          );
          return null;
        }

        return {
          id: chat._id,
          chatId: chat.chatId,
          status: chat.status,
          isArchived:
            req.user.role === "user"
              ? Boolean(chat.archivedByUser)
              : Boolean(chat.archivedByCounselor),
          otherParty: {
            id: otherParty._id,
            name: otherParty.fullName,
            anonymous: otherParty.anonymous,
            avatar: otherParty.profilePhoto?.url || null,
            age: otherParty.age ?? null,
            gender: otherParty.gender || null,
            dateOfBirth: otherParty.dateOfBirth || null,
            isOnline: otherParty.isOnline || false,
            lastSeen: otherParty.lastSeen || null,
            ...(req.user.role === "user" && {
              specialization: otherParty.specialization,
              rating: otherParty.rating,
              isActive: otherParty.isActive,
            }),
          },
          lastMessage: lastMessage
            ? {
                content: lastMessage.content,
                createdAt: lastMessage.createdAt,
                senderRole: lastMessage.senderRole,
              }
            : null,
          unreadCount,
          updatedAt: chat.updatedAt,
          startedAt: chat.startedAt,
          acceptedAt: chat.acceptedAt,
          rejectedAt: chat.rejectedAt,
          cancelledAt: chat.cancelledAt,
        };
      }),
    );

    res.json({ chats: chatsWithDetails.filter(Boolean) });
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Error fetching chats" });
  }
};

export const getPaymentConfig = async (_req, res) => {
  res.json(getPaidSessionConfig());
};

export const completeChatSession = async (req, res) => {
  try {
    const chat = await findChatByIdentifier(req.params.chatId);

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    const isAuthorized =
      (req.user.role === "user" &&
        chat.userId.toString() === req.user._id.toString()) ||
      (req.user.role === "counsellor" &&
        chat.counselorId.toString() === req.user._id.toString());

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const paidSession = await completePaidSession(chat);

    if (!paidSession) {
      chat.status = "closed";
      chat.closedAt = new Date();
      chat.isActive = false;
      await chat.save();
    }

    res.json({
      success: true,
      message: "Chat session completed",
      chat: {
        id: chat._id,
        chatId: chat.chatId,
        status: chat.status,
        paymentStatus: chat.paymentStatus,
        amount: chat.amount,
      },
      session: paidSession,
    });
  } catch (error) {
    console.error("Error completing chat session:", error);
    res.status(500).json({ error: "Error completing chat session" });
  }
};

// Return the current user's live chat requests so the counselor list can keep
// its button state after the tab is unmounted/remounted. Pending chats are
// intentionally included here (unlike getChats, which only powers the chat
// inbox and therefore returns accepted/active chats).
export const getMyChatStatuses = async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Only users can view chat statuses" });
    }

    const chats = await Chat.find({
      userId: req.user._id,
      isActive: true,
      status: { $in: ["pending", "accepted", "active"] },
    })
      .select("chatId counselorId status createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({
      chats: chats.map((chat) => ({
        id: chat._id,
        chatId: chat.chatId,
        counselorId: chat.counselorId,
        status: chat.status,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching user chat statuses:", error);
    return res.status(500).json({ error: "Error fetching chat statuses" });
  }
};

// Get chat messages
export const getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;

    // console.log('Getting messages for chat:', chatId);

    // Try to find chat by _id first, then by chatId
    let chat;

    if (mongoose.Types.ObjectId.isValid(chatId)) {
      chat = await Chat.findById(chatId);
    }

    if (!chat) {
      chat = await Chat.findOne({ chatId: chatId });
    }

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Check authorization
    const isAuthorized =
      (req.user.role === "user" &&
        chat.userId.toString() === req.user._id.toString()) ||
      (req.user.role === "counsellor" &&
        chat.counselorId.toString() === req.user._id.toString());

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Only allow viewing messages if chat is accepted or active
    // The user can open the chat as soon as a request is created. This keeps
    // the Chat Now action usable while the counselor's acceptance is pending.
    if (
      chat.status !== "pending" &&
      chat.status !== "accepted" &&
      chat.status !== "active"
    ) {
      return res.status(403).json({
        error: `Chat is ${chat.status}. Cannot view messages.`,
        status: chat.status,
      });
    }

    const messages = await Message.find({
      chatId: chat._id,
      ...visibleMessageFilter(req.user._id),
    }).sort({
      createdAt: 1,
    });

    // Mark messages as read
    let readResult = null;
    if (chat.status === "accepted" || chat.status === "active") {
      if (req.user.role === "user") {
        readResult = await Message.updateMany(
          {
            chatId: chat._id,
            senderRole: "counsellor",
            isRead: false,
            ...visibleMessageFilter(req.user._id),
          },
          { isRead: true, readAt: new Date() },
        );
      } else {
        readResult = await Message.updateMany(
          {
            chatId: chat._id,
            senderRole: "user",
            isRead: false,
            ...visibleMessageFilter(req.user._id),
          },
          { isRead: true, readAt: new Date() },
        );
      }
    }

    if (readResult?.modifiedCount > 0 && global.io) {
      global.io.to(`chat_${chat.chatId}`).emit("messages-read", {
        chatId: chat._id,
        publicChatId: chat.chatId,
        readerRole: req.user.role,
        readAt: new Date(),
      });
    }

    res.json({
      chatStatus: chat.status,
      messages: messages.map((msg) => ({
        id: msg._id,
        messageId: msg.messageId,
        content: msg.content,
        senderRole: msg.senderRole,
        contentType: msg.contentType,
        attachmentUrl: msg.attachmentUrl,
        attachmentName: msg.attachmentName,
        attachmentMimeType: msg.attachmentMimeType,
        attachmentSize: msg.attachmentSize,
        createdAt: msg.createdAt,
        isRead: msg.isRead,
      })),
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Error fetching messages" });
  }
};

// Send message (only if chat is accepted)
export const sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content } = req.body;
    const attachment = req.file;
    const trimmedContent = typeof content === "string" ? content.trim() : "";

    if (!attachment && !trimmedContent) {
      return res
        .status(400)
        .json({ error: "Message content or attachment is required" });
    }

    // Find chat by either _id OR chatId
    let chat;

    // Check if it's a valid ObjectId
    if (mongoose.Types.ObjectId.isValid(chatId)) {
      chat = await Chat.findById(chatId);
    }

    // If not found by _id, try to find by chatId field
    if (!chat) {
      chat = await Chat.findOne({ chatId: chatId });
    }

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Check authorization
    const isAuthorized =
      (req.user.role === "user" &&
        chat.userId.toString() === req.user._id.toString()) ||
      (req.user.role === "counsellor" &&
        chat.counselorId.toString() === req.user._id.toString());

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Only allow messaging if chat is pending, accepted, or active
    if (chat.status !== "pending" && chat.status !== "accepted" && chat.status !== "active") {
      return res.status(403).json({
        error: `Cannot send messages. Chat is ${chat.status}.`,
        status: chat.status,
      });
    }

    // Check if admin has blocked the counselor from chatting
    const counselorForMsg = await User.findById(chat.counselorId).lean();
    if (counselorForMsg?.chatPermission?.enabled === false) {
      return res.status(403).json({
        error: "Chat access has been restricted by admin.",
        reason: counselorForMsg.chatPermission.disabledReason || "admin_decision",
      });
    }

    const hasAttachment = Boolean(attachment);
    const isImageAttachment =
      hasAttachment && (attachment.mimetype || "").startsWith("image/");
    const messageContent = hasAttachment
      ? trimmedContent || attachment.originalname || "Attachment"
      : trimmedContent;

    const messagePayload = {
      chatId: chat._id,
      senderId: req.user._id,
      senderRole: req.user.role,
      content: messageContent,
      contentType: hasAttachment
        ? isImageAttachment
          ? "IMAGE"
          : "FILE"
        : "TEXT",
    };

    if (hasAttachment) {
      messagePayload.attachmentUrl =
        attachment.path || attachment.secure_url || null;
      messagePayload.attachmentName = attachment.originalname || null;
      messagePayload.attachmentMimeType = attachment.mimetype || null;
      messagePayload.attachmentSize = attachment.size || null;
    }

    // Any new message makes the durable conversation visible to both sides,
    // so an incoming message can never be silently hidden.
    const wasRestored = restoreChatForBothParticipants(chat);

    // Create message using chat._id (ObjectId)
    const message = await Message.create(messagePayload);

    // Update chat's last message
    chat.lastMessage = hasAttachment
      ? `📎 ${messagePayload.attachmentName || "Attachment"}`
      : messageContent;
    chat.lastMessageAt = new Date();
    chat.updatedAt = new Date();
    await chat.save();

    // Populate the message with sender info
    const populatedMessage = await Message.findById(message._id).populate(
      "senderId",
      "fullName profilePhoto",
    );

    const messagePayloadForSocket = {
      id: populatedMessage._id,
      messageId: populatedMessage.messageId,
      chatId: chat._id,
      publicChatId: chat.chatId,
      content: populatedMessage.content,
      senderRole: populatedMessage.senderRole,
      senderName: populatedMessage.senderId?.fullName,
      senderId: populatedMessage.senderId?._id,
      contentType: populatedMessage.contentType,
      attachmentUrl: populatedMessage.attachmentUrl,
      attachmentName: populatedMessage.attachmentName,
      attachmentMimeType: populatedMessage.attachmentMimeType,
      attachmentSize: populatedMessage.attachmentSize,
      createdAt: populatedMessage.createdAt,
      isRead: populatedMessage.isRead,
    };

    const recipientId =
      req.user.role === "user" ? chat.counselorId : chat.userId;
    const recipientRole = req.user.role === "user" ? "counsellor" : "user";

    // ✅ Emit real-time event to everyone in the chat room (REST-based send)
    if (global.io) {
      const chatRoom = `chat_${chat.chatId}`;
      global.io.to(chatRoom).emit("new-message", messagePayloadForSocket);

      // Also notify the recipient's personal room for sidebar/badge updates
      const recipientRoom =
        req.user.role === "user"
          ? `counsellor_${chat.counselorId}`
          : `user_${chat.userId}`;
      const recipientAltRoom =
        req.user.role === "user" ? `counselor_${chat.counselorId}` : null;
      global.io.to(`user_${recipientId}`).emit("new-message", messagePayloadForSocket);
      global.io.to(recipientRoom).emit("new-message", messagePayloadForSocket);
      if (recipientAltRoom) {
        global.io.to(recipientAltRoom).emit("new-message", messagePayloadForSocket);
      }
      const chatListUpdate = {
        chatId: chat._id,
        publicChatId: chat.chatId,
        restored: wasRestored,
        lastMessage: messagePayloadForSocket,
      };
      global.io.to(`user_${chat.userId}`).emit("chat-list-update", chatListUpdate);
      global.io.to(`user_${chat.counselorId}`).emit("chat-list-update", chatListUpdate);
      global.io.to(`counsellor_${chat.counselorId}`).emit("chat-list-update", chatListUpdate);
      global.io.to(`counselor_${chat.counselorId}`).emit("chat-list-update", chatListUpdate);
    }

    await createNotificationSafely({
      recipientId,
      actorId: req.user._id,
      type: "message",
      title: populatedMessage.senderId?.fullName || "New message",
      message: hasAttachment ? chat.lastMessage : messageContent,
      data: {
        type: "CHAT_MESSAGE",
        chatId: chat._id,
        publicChatId: chat.chatId,
        senderId: req.user._id,
        senderRole: req.user.role,
        senderName: populatedMessage.senderId?.fullName || "",
        recipientRole,
        messageId: populatedMessage.messageId || populatedMessage._id,
        contentType: populatedMessage.contentType,
      },
      actionUrl: `/chat/${chat._id}`,
    });

    // Billing follows real conversation activity, not React renders or every
    // individual message. Each message extends one inactivity-window session.
    recordTimedChatActivity(chat).catch((billingError) => {
      console.error("Chat activity billing update failed:", billingError.message);
    });

    res.json({
      success: true,
      message: messagePayloadForSocket,
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Error sending message" });
  }
};

// Delete chat (soft delete)
export const deleteChat = async (req, res) => {
  try {
    const chat = await findChatByIdentifier(req.params.chatId);

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Check authorization
    const isAuthorized =
      (req.user.role === "user" &&
        chat.userId.toString() === req.user._id.toString()) ||
      (req.user.role === "counsellor" &&
        chat.counselorId.toString() === req.user._id.toString());

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Participant-specific soft hide. Existing messages are hidden only for
    // the participant who deleted the conversation. They remain intact for
    // the other participant and in the database. Messages created after this
    // operation do not contain this participant in deletedFor, so a restored
    // conversation starts with only the new messages (WhatsApp-style).
    const hiddenMessagesResult = await Message.updateMany(
      {
        chatId: chat._id,
        ...visibleMessageFilter(req.user._id),
      },
      { $addToSet: { deletedFor: req.user._id } },
    );

    if (req.user.role === "user") {
      chat.deletedByUser = true;
    } else {
      chat.deletedByCounselor = true;
    }
    if (["accepted", "active"].includes(chat.status)) {
      chat.isActive = true;
    }
    await chat.save();

    res.json({
      success: true,
      message: "Chat hidden successfully",
      chatId: chat._id,
      hiddenFor: req.user.role,
      hiddenMessageCount: hiddenMessagesResult.modifiedCount,
    });
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({ error: "Error deleting chat" });
  }
};

// Clear all messages in chat
export const clearChat = async (req, res) => {
  try {
    const chat = await findChatByIdentifier(req.params.chatId);

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Check authorization
    const isAuthorized =
      (req.user.role === "user" &&
        chat.userId.toString() === req.user._id.toString()) ||
      (req.user.role === "counsellor" &&
        chat.counselorId.toString() === req.user._id.toString());

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Hide all messages only for the current participant.
    const result = await Message.updateMany(
      {
        chatId: chat._id,
        ...visibleMessageFilter(req.user._id),
      },
      { $addToSet: { deletedFor: req.user._id } },
    );

    res.json({
      success: true,
      message: "Chat cleared for you successfully",
      deletedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error clearing chat:", error);
    res.status(500).json({ error: "Error clearing chat" });
  }
};

// Get unread count
export const getUnreadCount = async (req, res) => {
  try {
    let unreadCount = 0;

    if (req.user.role === "user") {
      const chats = await Chat.find({ userId: req.user._id, isActive: true });
      for (const chat of chats) {
        const count = await Message.countDocuments({
          chatId: chat._id,
          senderRole: "counsellor",
          isRead: false,
          ...visibleMessageFilter(req.user._id),
        });
        unreadCount += count;
      }
    } else if (req.user.role === "counsellor") {
      const chats = await Chat.find({
        counselorId: req.user._id,
        isActive: true,
      });
      for (const chat of chats) {
        const count = await Message.countDocuments({
          chatId: chat._id,
          senderRole: "user",
          isRead: false,
          ...visibleMessageFilter(req.user._id),
        });
        unreadCount += count;
      }
    }

    res.json({ success: true, unreadCount });
  } catch (error) {
    console.error("Error getting unread count:", error);
    res.status(500).json({ error: "Error getting unread count" });
  }
};

// ==================== COUNSELOR MANAGEMENT ====================

// Get available counselors
export const getCounselors = async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Only users can view counselors" });
    }

    const counselors = await User.find(
      {
        ...visibleCounselorFilter,
      },
      {
        password: 0,
        emailOTP: 0,
        phoneOTP: 0,
        profilePhotoPublicId: 0,
      },
    )
      .select(
        "fullName specialization experience qualification aboutMe profilePhoto rating ratingCount totalSessions languages consultationMode location isOnline lastSeen profileCompleted",
      )
      .sort({ rating: -1, fullName: 1 });

    res.json({ counselors });
  } catch (error) {
    console.error("Error fetching counselors:", error);
    res.status(500).json({ error: "Error fetching counselors" });
  }
};

// Get counselor details
export const getCounselorDetails = async (req, res) => {
  try {
    const counselor = await User.findOne(
      {
        _id: req.params.counselorId,
        ...visibleCounselorFilter,
      },
      {
        password: 0,
        emailOTP: 0,
        phoneOTP: 0,
        profilePhotoPublicId: 0,
      },
    );

    if (!counselor) {
      return res.status(404).json({ error: "Counselor not found" });
    }

    res.json({ counselor });
  } catch (error) {
    console.error("Error fetching counselor:", error);
    res.status(500).json({ error: "Error fetching counselor" });
  }
};

// Update online status (counselor only)
export const updateStatus = async (req, res) => {
  try {
    if (req.user.role !== "counsellor") {
      return res
        .status(403)
        .json({ error: "Only counselors can update status" });
    }

    const { online } = req.body;

    // Update counselor status in database if you have an isOnline field
    // await User.findByIdAndUpdate(req.user._id, { isOnline: online });

    res.json({ message: "Status updated successfully", online });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ error: "Error updating status" });
  }
};

// Search counselors
export const searchCounselors = async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res
        .status(403)
        .json({ error: "Only users can search counselors" });
    }

    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const searchRegex = new RegExp(q, "i");

    const counselors = await User.find(
      {
        ...visibleCounselorFilter,
        $or: [
          { fullName: searchRegex },
          { specialization: { $in: [searchRegex] } },
          { location: searchRegex },
          { aboutMe: searchRegex },
        ],
      },
      {
        password: 0,
        emailOTP: 0,
        phoneOTP: 0,
        profilePhotoPublicId: 0,
      },
    )
      .select(
        "fullName specialization experience qualification aboutMe profilePhoto rating ratingCount totalSessions languages consultationMode location isOnline lastSeen profileCompleted",
      )
      .sort({ rating: -1, fullName: 1 });

    res.json({ counselors, count: counselors.length });
  } catch (error) {
    console.error("Error searching counselors:", error);
    res.status(500).json({ error: "Error searching counselors" });
  }
};

export const markAllRead = async (req, res) => {
  try {
    const { chatId } = req.body;

    let chat = await findChatByIdentifier(chatId);

    // Fallback: if frontend sends otherParty._id as chatId
    if (!chat && mongoose.Types.ObjectId.isValid(chatId)) {
      chat = await Chat.findOne({
        $or: [
          { userId: chatId, counselorId: req.user._id },
          { userId: req.user._id, counselorId: chatId },
        ],
      });
    }

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Check authorization
    const isAuthorized =
      (req.user.role === "user" &&
        chat.userId.toString() === req.user._id.toString()) ||
      (req.user.role === "counsellor" &&
        chat.counselorId.toString() === req.user._id.toString());

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Mark messages as read
    const result = await Message.updateMany(
      {
        $or: [{ chatId: chat._id }, { chatId: chat.chatId }],
        senderRole: req.user.role === "user" ? "counsellor" : "user",
        isRead: false,
      },
      {
        $set: { isRead: true, readAt: new Date() },
      },
    );

    if (result.modifiedCount > 0 && global.io) {
      global.io.to(`chat_${chat.chatId}`).emit("messages-read", {
        chatId: chat._id,
        publicChatId: chat.chatId,
        readerRole: req.user.role,
        readAt: new Date(),
      });
    }

    res.json({
      success: true,
      message: "All messages marked as read",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ error: "Error marking messages as read" });
  }
};

// Archive/unarchive a conversation only for the current participant.
export const setChatArchived = async (req, res) => {
  try {
    const chat = await findChatByIdentifier(req.params.chatId);

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    const isUser = req.user.role === "user";
    const isCounselor = req.user.role === "counsellor";
    const isAuthorized =
      (isUser && chat.userId.toString() === req.user._id.toString()) ||
      (isCounselor &&
        chat.counselorId.toString() === req.user._id.toString());

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const archived = req.body?.archived !== false;
    if (isUser) {
      chat.archivedByUser = archived;
      chat.archivedByUserAt = archived ? new Date() : null;
    } else {
      chat.archivedByCounselor = archived;
      chat.archivedByCounselorAt = archived ? new Date() : null;
    }

    await chat.save();

    res.json({
      success: true,
      chatId: chat._id,
      archived,
      message: archived
        ? "Chat archived successfully"
        : "Chat unarchived successfully",
    });
  } catch (error) {
    console.error("Error updating chat archive status:", error);
    res.status(500).json({ error: "Error updating chat archive status" });
  }
};

// Hide one personal-chat message for the current participant only.
// The other participant keeps seeing the message in their own chat history.
export const deletePersonalMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await Message.findOne({
      $or: [{ _id: mongoose.Types.ObjectId.isValid(messageId) ? messageId : null }, { messageId }],
    });

    if (!message) return res.status(404).json({ success: false, error: "Message not found" });
    const chat = await findChatByIdentifier(String(message.chatId));
    if (!chat) return res.status(404).json({ success: false, error: "Chat not found" });

    const isParticipant = [String(chat.userId), String(chat.counselorId)].includes(String(req.user._id));
    if (!isParticipant) return res.status(403).json({ success: false, error: "Unauthorized" });

    await Message.updateOne(
      { _id: message._id },
      { $addToSet: { deletedFor: req.user._id } },
    );

    if (global.io) {
      global.io.to(`user_${req.user._id}`).emit("message-deleted", {
        chatId: String(chat._id),
        messageId: String(message._id),
        publicMessageId: message.messageId,
        deletedForUserId: String(req.user._id),
      });
    }

    return res.json({
      success: true,
      messageId: String(message._id),
      publicMessageId: message.messageId,
      deleteMode: "for_me",
    });
  } catch (error) {
    console.error("Error deleting personal chat message:", error);
    return res.status(500).json({ success: false, error: "Failed to delete message" });
  }
};
