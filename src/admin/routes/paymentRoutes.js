import express from "express";
import {
  getWalletPayments,
  getWalletPaymentStats,
  verifyAndCreditWalletPayment
} from "../controllers/paymentController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

router.get("/", verifyAdminToken, getWalletPayments);
router.get("/stats", verifyAdminToken, getWalletPaymentStats);
router.post("/:id/verify-and-credit", verifyAdminToken, verifyAndCreditWalletPayment);

export default router;
