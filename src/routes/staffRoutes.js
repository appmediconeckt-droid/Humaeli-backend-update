// src/routes/staffRoutes.js
import express from "express";
import {
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
} from "../controllers/staffController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";

const router = express.Router();
router.use(authMiddleware, authorizeRoles("doctor", "counsellor"));

router.get("/", getStaff);
router.post("/", createStaff);
router.patch("/:id", updateStaff);
router.put("/:id", updateStaff);
router.delete("/:id", deleteStaff);

export default router;
