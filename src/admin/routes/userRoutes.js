import express from "express";
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserStats,
  toggleAccountStatus,
  bulkToggleStatus
} from "../controllers/userController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

router.get("/", verifyAdminToken, getAllUsers);
router.get("/stats", verifyAdminToken, getUserStats);
router.get("/:id", verifyAdminToken, getUserById);
router.put("/:id", verifyAdminToken, updateUser);
router.put("/:id/toggle-status", verifyAdminToken, toggleAccountStatus);
router.post("/bulk/toggle-status", verifyAdminToken, bulkToggleStatus);
router.delete("/:id", verifyAdminToken, deleteUser);

export default router;
