import express from "express";
import { getAllReviews } from "../controllers/reviewController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

router.get("/", verifyAdminToken, getAllReviews);

export default router;
