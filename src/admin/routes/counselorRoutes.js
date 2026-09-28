import express from "express";
import {
  getAllCounselors,
  getCounselorById,
  updateCounselor,
  deleteCounselor,
  approveCounselors,
  rejectCounselors,
  getCounselorStats,
  getCounselorsWithoutSpecialization,
  updateChatPermission,
  getChatPermission,
} from "../controllers/counselorController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

router.get("/", verifyAdminToken, getAllCounselors);
router.get("/stats", verifyAdminToken, getCounselorStats);
router.get("/missing/specialization", verifyAdminToken, getCounselorsWithoutSpecialization);
router.post("/approve", verifyAdminToken, approveCounselors);
router.post("/reject", verifyAdminToken, rejectCounselors);
router.get("/:id", verifyAdminToken, getCounselorById);
router.put("/:id", verifyAdminToken, updateCounselor);
router.delete("/:id", verifyAdminToken, deleteCounselor);
router.get("/:id/chat-permission", verifyAdminToken, getChatPermission);
router.put("/:id/chat-permission", verifyAdminToken, updateChatPermission);

export default router;
