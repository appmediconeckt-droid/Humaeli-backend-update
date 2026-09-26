// src/controllers/admin/adminPayoutController.js
import Payout from "../../models/mysql/PayoutModel.js";
import Transaction from "../../models/mysql/TransactionModel.js";
import User from "../../models/userModel.js";
import CounselorEarning from "../../models/mysql/CounselorEarningModel.js";
import { v4 as uuidv4 } from "uuid";

const generatePayoutId = () => `PAY-${uuidv4().slice(0, 8).toUpperCase()}`;

// Helper: notify counselor via main backend (forward-compatible)
const createCounselorNotification = async ({ recipientId, title, message }) => {
  try {
    const Notification = (await import("../../models/notificationModel.js")).default;
    if (Notification && recipientId) {
      await Notification.create({ userId: recipientId, title, message, type: "payout" });
    }
  } catch {
    // Notification model may differ; silently ignore
  }
};

export const getAllPayouts = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, sortBy = "createdAt" } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    if (status) filter.status = status.toUpperCase();

    const [payouts, total] = await Promise.all([
      Payout.find(filter).sort({ createdAt: -1 }).skip(parseInt(skip)).limit(parseInt(limit)),
      Payout.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: payouts,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("Error in getAllPayouts:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getPendingPayouts = async (req, res) => {
  try {
    const payouts = await Payout.find({ status: "PENDING" }).sort({ createdAt: -1 });
    const totalPending = payouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    res.json({ success: true, count: payouts.length, totalAmount: totalPending, data: payouts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getPayoutStats = async (req, res) => {
  try {
    const all = await Payout.find();
    const byStatus = {};
    for (const p of all) {
      if (!byStatus[p.status]) byStatus[p.status] = { _id: p.status, count: 0, totalAmount: 0 };
      byStatus[p.status].count++;
      byStatus[p.status].totalAmount += Number(p.amount) || 0;
    }
    const overall = Object.values(byStatus).reduce(
      (acc, row) => ({
        totalPayouts: acc.totalPayouts + row.count,
        totalAmount: acc.totalAmount + row.totalAmount,
        totalNet: acc.totalNet + (row._id === "COMPLETED" ? row.totalAmount : 0),
        totalTax: acc.totalTax,
      }),
      { totalPayouts: 0, totalAmount: 0, totalTax: 0, totalNet: 0 }
    );

    res.json({ success: true, byStatus: Object.values(byStatus), overall });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getPayoutById = async (req, res) => {
  try {
    const payout = await Payout.findById(req.params.id);
    if (!payout) {
      return res.status(404).json({ success: false, error: "Payout not found" });
    }
    res.json({ success: true, data: payout });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createPayout = async (req, res) => {
  try {
    const { counselorId, amount, period, taxAmount = 0, notes } = req.body;

    if (!counselorId || !amount) {
      return res.status(400).json({ success: false, error: "counselorId and amount are required" });
    }

    const counselor = await User.findById(counselorId);
    if (!counselor) {
      return res.status(404).json({ success: false, error: "Counselor not found" });
    }

    const netAmount = Number(amount) - Number(taxAmount);
    const payout = await Payout.create({
      payoutId: generatePayoutId(),
      counselorId: String(counselorId),
      counselorName: counselor.fullName,
      counselorEmail: counselor.email,
      amount: Number(amount),
      taxAmount: Number(taxAmount),
      netAmount,
      period: period || null,
      notes: notes || null,
      status: "PENDING",
    });

    res.json({ success: true, message: "Payout created successfully", data: payout });
  } catch (err) {
    console.error("Error in createPayout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updatePayoutBankDetails = async (req, res) => {
  try {
    const { bankDetails, paymentMethod } = req.body;
    const payout = await Payout.findByIdAndUpdate(
      req.params.id,
      { bankDetails: JSON.stringify(bankDetails), paymentMethod },
      { new: true }
    );
    if (!payout) return res.status(404).json({ success: false, error: "Payout not found" });
    res.json({ success: true, message: "Bank details updated", data: payout });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const approvePayout = async (req, res) => {
  try {
    const { notes } = req.body;
    const payout = await Payout.findByIdAndUpdate(
      req.params.id,
      { status: "APPROVED", approvedBy: req.user?.email, approvedAt: new Date(), notes },
      { new: true }
    );
    if (!payout) return res.status(404).json({ success: false, error: "Payout not found" });
    res.json({ success: true, message: "Payout approved", data: payout });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const processPayout = async (req, res) => {
  try {
    const { transactionReference } = req.body;
    if (!String(transactionReference || "").trim()) {
      return res.status(400).json({ success: false, error: "Bank transaction reference/UTR is required" });
    }
    const payout = await Payout.findById(req.params.id);
    if (!payout) return res.status(404).json({ success: false, error: "Payout not found" });
    if (payout.status !== "APPROVED") {
      return res.status(400).json({ success: false, error: "Only approved payouts can be processed" });
    }
    payout.status = "COMPLETED";
    payout.processedBy = req.user?.email;
    payout.processedAt = new Date();
    payout.completedAt = new Date();
    payout.transactionReference = transactionReference;
    await Payout.updateOne({ id: payout.id }, payout);
    res.json({ success: true, message: "Payout processed successfully", data: payout });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const rejectPayout = async (req, res) => {
  try {
    const { failureReason } = req.body;
    const payout = await Payout.findByIdAndUpdate(
      req.params.id,
      { status: "CANCELLED", failureReason },
      { new: true }
    );
    if (!payout) return res.status(404).json({ success: false, error: "Payout not found" });
    res.json({ success: true, message: "Payout cancelled", data: payout });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getPayoutHistory = async (req, res) => {
  try {
    const { counselorId } = req.params;
    const payouts = await Payout.find({ counselorId }).sort({ createdAt: -1 });
    const stats = {
      totalPayouts: payouts.length,
      totalAmount: payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0),
      completedAmount: payouts.filter((p) => p.status === "COMPLETED").reduce((s, p) => s + (Number(p.amount) || 0), 0),
      pendingAmount: payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + (Number(p.amount) || 0), 0),
      approvedAmount: payouts.filter((p) => p.status === "APPROVED").reduce((s, p) => s + (Number(p.amount) || 0), 0),
    };
    res.json({ success: true, stats, data: payouts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
