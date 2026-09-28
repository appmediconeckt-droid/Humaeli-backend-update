import express from "express";
import {
  createNotificationRule,
  deleteNotificationRule,
  getActiveNotificationRulesForInternalJob,
  getNotificationDeliveries,
  getNotificationDeliveryById,
  getNotificationRuleById,
  getNotificationRules,
  previewNotificationRule,
  sendPromotionNotification,
  setNotificationRuleStatus,
  testNotificationRule,
  updateNotificationRule,
} from "../controllers/notificationController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

const authorizeInternalJob = (req, res, next) => {
  const configuredSecret = process.env.ADMIN_INTERNAL_JOB_SECRET;
  const providedSecret = req.get("x-internal-job-secret");

  if (!configuredSecret || providedSecret !== configuredSecret) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  return next();
};

router.post("/promotion", verifyAdminToken, sendPromotionNotification);
router.get("/deliveries", verifyAdminToken, getNotificationDeliveries);
router.get("/deliveries/:id", verifyAdminToken, getNotificationDeliveryById);
router.get(
  "/internal/rules/active",
  authorizeInternalJob,
  getActiveNotificationRulesForInternalJob,
);
router.post("/rules", verifyAdminToken, createNotificationRule);
router.get("/rules", verifyAdminToken, getNotificationRules);
router.post("/rules/:id/preview", verifyAdminToken, previewNotificationRule);
router.post("/rules/:id/test", verifyAdminToken, testNotificationRule);
router.get("/rules/:id", verifyAdminToken, getNotificationRuleById);
router.put("/rules/:id", verifyAdminToken, updateNotificationRule);
router.delete("/rules/:id", verifyAdminToken, deleteNotificationRule);
router.patch("/rules/:id/status", verifyAdminToken, setNotificationRuleStatus);

export default router;
