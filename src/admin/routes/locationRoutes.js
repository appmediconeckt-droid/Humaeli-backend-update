import express from "express";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";
import { adminGetLocationHistory } from "../controllers/locationController.js";

const router = express.Router();

router.get("/:userId/history", verifyAdminToken, adminGetLocationHistory);

export default router;

