// src/routes/followUpRoutes.js
import express from "express";
import {
  getFollowUps,
  createFollowUp,
  updateFollowUp,
  deleteFollowUp,
} from "../controllers/followUpController.js";
import { optionalAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", optionalAuth, getFollowUps);
router.post("/", optionalAuth, createFollowUp);
router.put("/:id", optionalAuth, updateFollowUp);
router.patch("/:id", optionalAuth, updateFollowUp);
router.delete("/:id", optionalAuth, deleteFollowUp);

export default router;
