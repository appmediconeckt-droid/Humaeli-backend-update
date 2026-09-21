import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  endBreak,
  getActiveBreak,
  startBreak,
} from "../controllers/doctorBreakController.js";

const router = express.Router();
router.use(protect);
router.post("/start", startBreak);
router.patch("/:breakId/end", endBreak);
router.get("/active", getActiveBreak);

export default router;
