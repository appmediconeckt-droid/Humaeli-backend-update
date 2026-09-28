import express from "express";
import { getGeneralSettings, updateGeneralSettings } from "../controllers/settingsController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

router.get("/general", verifyAdminToken, getGeneralSettings);
router.put("/general", verifyAdminToken, updateGeneralSettings);

export default router;
