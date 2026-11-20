
// export default router;
import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { uploadChatAttachment } from "../middleware/multerConfig.js";
import {
  getChats,
  startChat,
  acceptChat,
  rejectChat,
  completeChatSession,
  getPendingRequests,
  getPaymentConfig,
  startChatUsage,
  stopChatUsage,
  touchChatUsage,
  getMyChatStatuses,
  getChatMessages,
  sendMessage,
  deletePersonalMessage,
  deleteChat,
  setChatArchived,
  clearChat,
  setUserChatBlock,
  getChatBlockStatus,
  markAllRead,
  getUnreadCount,
  getCounselors,
  getCounselorDetails,
  updateStatus,
  searchCounselors,
} from "../controllers/messageController.js";

const router = express.Router();

// ==================== CHAT REQUEST ROUTES ====================
router.post("/start", authenticateToken, startChat);
router.patch("/accept/:chatId", authenticateToken, acceptChat);
router.patch("/reject/:chatId", authenticateToken, rejectChat);
router.patch("/complete/:chatId", authenticateToken, completeChatSession);
router.get("/pending-requests", authenticateToken, getPendingRequests);
router.get("/payment-config", getPaymentConfig);
router.post("/chat/:chatId/billing/start", authenticateToken, startChatUsage);
router.post("/chat/:chatId/billing/stop", authenticateToken, stopChatUsage);
router.post("/chat/:chatId/billing/heartbeat", authenticateToken, touchChatUsage);

// ==================== CHAT MANAGEMENT ROUTES ====================
router.get("/chats", authenticateToken, getChats);
router.get("/chat-statuses", authenticateToken, getMyChatStatuses);
router.get("/chat/:chatId/messages", authenticateToken, getChatMessages);
router.post(
  "/chat/:chatId/message",
  authenticateToken,
  uploadChatAttachment,
  sendMessage,
);
router.delete("/message/:messageId", authenticateToken, deletePersonalMessage);
router.delete("/chat/:chatId", authenticateToken, deleteChat);
router.patch("/chat/:chatId/archive", authenticateToken, setChatArchived);
router.patch("/chat/:chatId/block", authenticateToken, setUserChatBlock);
router.get("/chat/:chatId/block", authenticateToken, getChatBlockStatus);
// Backward-compatible aliases used by older web/mobile clients.
router.delete("/chats/:chatId", authenticateToken, deleteChat);
router.delete("/clear/:chatId", authenticateToken, clearChat);
router.post("/mark-all-read", authenticateToken, markAllRead);
router.get("/unread-count", authenticateToken, getUnreadCount);

// ==================== COUNSELOR ROUTES ====================
router.get("/counselors", authenticateToken, getCounselors);
router.get("/counselor/:counselorId", authenticateToken, getCounselorDetails);
router.patch("/status", authenticateToken, updateStatus);
router.get("/search/counselors", authenticateToken, searchCounselors);

// Get all counsellors from database

export default router;
