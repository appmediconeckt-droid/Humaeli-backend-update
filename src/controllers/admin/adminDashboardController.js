// src/controllers/admin/adminDashboardController.js
import User from "../../models/userModel.js";
import AuditLog from "../../models/mysql/AuditLogModel.js";
import Payout from "../../models/mysql/PayoutModel.js";
import CounselorEarning from "../../models/mysql/CounselorEarningModel.js";
import Transaction from "../../models/mysql/TransactionModel.js";
import SupportTicket from "../../models/mysql/SupportTicketModel.js";

const PROFESSIONAL_ROLES = ["doctor", "consultant", "counselor", "counsellor", "counsellour"];

export const getDashboardAnalytics = async (req, res) => {
  try {
    const [totalUsers, totalCounselors, verifiedUsers, verifiedCounselors, activeUsers, activeCounselors] =
      await Promise.all([
        User.countDocuments({ role: "user" }),
        User.countDocuments({ role: { $in: PROFESSIONAL_ROLES } }),
        User.countDocuments({ role: "user", isVerified: true }),
        User.countDocuments({ role: { $in: PROFESSIONAL_ROLES }, isVerified: true }),
        User.countDocuments({ role: "user", isActive: true }),
        User.countDocuments({ role: { $in: PROFESSIONAL_ROLES }, isActive: true }),
      ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalCounselors,
        verifiedUsers,
        verifiedCounselors,
        activeUsers,
        activeCounselors,
        verificationRateUsers: totalUsers > 0 ? ((verifiedUsers / totalUsers) * 100).toFixed(2) : 0,
        verificationRateCounselors:
          totalCounselors > 0
            ? ((verifiedCounselors / totalCounselors) * 100).toFixed(2)
            : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getUserGrowthData = async (req, res) => {
  try {
    const data = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const [userCount, counselorCount] = await Promise.all([
        User.countDocuments({ role: "user", createdAt: { $gte: date, $lt: nextDate } }),
        User.countDocuments({
          role: { $in: PROFESSIONAL_ROLES },
          createdAt: { $gte: date, $lt: nextDate },
        }),
      ]);

      data.push({ date: date.toLocaleDateString(), users: userCount, counselors: counselorCount });
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getSystemHealth = async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        database: "connected",
        apiStatus: "operational",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getRecentActivities = async (req, res) => {
  try {
    const [recentUsers, recentCounselors] = await Promise.all([
      User.find({ role: "user" }).sort({ createdAt: -1 }).limit(5),
      User.find({ role: { $in: PROFESSIONAL_ROLES } }).sort({ createdAt: -1 }).limit(5),
    ]);

    res.json({
      success: true,
      data: { recentUsers, recentCounselors },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getRevenueData = async (req, res) => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // MySQL aggregate: sum all earnings
    const allEarnings = await CounselorEarning.find({
      earningStatus: { $in: ["completed", null, undefined] },
    });
    const totalRevenue = allEarnings.reduce((s, e) => s + (Number(e.totalAmount) || 0), 0);
    const platformEarnings = allEarnings.reduce((s, e) => s + (Number(e.commission) || 0), 0);
    const counselorEarnings = allEarnings.reduce((s, e) => s + (Number(e.earningAmount) || 0), 0);

    const monthEarnings = allEarnings.filter(
      (e) => e.createdAt && new Date(e.createdAt) >= startOfMonth
    );
    const thisMonthRevenue = monthEarnings.reduce((s, e) => s + (Number(e.totalAmount) || 0), 0);

    const [totalTransactions, failedTransactions] = await Promise.all([
      Transaction.countDocuments({ status: "completed" }),
      Transaction.countDocuments({ status: "failed" }),
    ]);

    const refundedTx = await Transaction.find({ status: "refunded" });
    const refundedAmount = refundedTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    res.json({
      success: true,
      data: {
        totalRevenue,
        platformEarnings,
        counselorEarnings,
        thisMonthRevenue,
        totalTransactions,
        failedTransactions,
        refundedAmount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getRevenueTimeSeries = async (req, res) => {
  try {
    const data = [];
    const today = new Date();
    const allEarnings = await CounselorEarning.find();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayEarnings = allEarnings.filter((e) => {
        const d = e.createdAt ? new Date(e.createdAt) : null;
        return d && d >= date && d < nextDate;
      });
      const revenue = dayEarnings.reduce((s, e) => s + (Number(e.totalAmount) || 0), 0);
      data.push({ date: date.toLocaleDateString(), revenue });
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20, action, entityType } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    if (action) filter.action = action;
    if (entityType) filter.entityType = entityType;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit)),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getNotifications = async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      pendingCounselors,
      pendingCounselorCount,
      pendingPayouts,
      pendingPayoutCount,
      newUsersToday,
      newUserCount,
      failedLogs,
      failedLogCount,
      unreadSupportTickets,
      unreadSupportCount,
    ] = await Promise.all([
      User.find({ role: { $in: PROFESSIONAL_ROLES }, isVerified: false })
        .sort({ createdAt: -1 })
        .limit(5),
      User.countDocuments({ role: { $in: PROFESSIONAL_ROLES }, isVerified: false }),
      Payout.find({ status: "PENDING" }).sort({ createdAt: -1 }).limit(5),
      Payout.countDocuments({ status: "PENDING" }),
      User.find({ role: "user", createdAt: { $gte: since24h } })
        .sort({ createdAt: -1 })
        .limit(5),
      User.countDocuments({ role: "user", createdAt: { $gte: since24h } }),
      AuditLog.find({ status: "FAILURE", createdAt: { $gte: since7d } })
        .sort({ createdAt: -1 })
        .limit(5),
      AuditLog.countDocuments({ status: "FAILURE", createdAt: { $gte: since7d } }),
      SupportTicket.find({ unreadByAdmin: true }).sort({ lastMessageAt: -1 }).limit(5),
      SupportTicket.countDocuments({ unreadByAdmin: true }),
    ]);

    const pendingPayoutTotal = pendingPayouts.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const groups = [];

    if (unreadSupportCount > 0) {
      groups.push({
        key: "support_unread",
        title: "New support messages",
        icon: "support_agent",
        severity: "warning",
        link: "/support",
        count: unreadSupportCount,
        items: unreadSupportTickets.map((t) => ({
          id: t._id || t.id,
          label: t.requesterName || t.requesterEmail,
          meta: t.subject,
          at: t.lastMessageAt,
        })),
      });
    }

    if (pendingCounselorCount > 0) {
      groups.push({
        key: "counselor_verify",
        title: "Counselors awaiting verification",
        icon: "psychology",
        severity: "warning",
        link: "/counselors",
        count: pendingCounselorCount,
        items: pendingCounselors.map((c) => ({
          id: c._id || c.id,
          label: c.fullName || "Unnamed counselor",
          meta: c.email,
          at: c.createdAt,
        })),
      });
    }

    if (pendingPayoutCount > 0) {
      groups.push({
        key: "payout_pending",
        title: "Pending payout requests",
        icon: "account_balance_wallet",
        severity: "info",
        link: "/payouts",
        count: pendingPayoutCount,
        totalAmount: pendingPayoutTotal,
        items: pendingPayouts.map((p) => ({
          id: p._id || p.id,
          label: p.counselorName || p.payoutId,
          meta: `${p.currency || "USD"} ${p.amount}`,
          at: p.createdAt,
        })),
      });
    }

    if (newUserCount > 0) {
      groups.push({
        key: "new_users",
        title: "New users (last 24h)",
        icon: "person_add",
        severity: "success",
        link: "/users",
        count: newUserCount,
        items: newUsersToday.map((u) => ({
          id: u._id || u.id,
          label: u.fullName || "Unnamed user",
          meta: u.email,
          at: u.createdAt,
        })),
      });
    }

    if (failedLogCount > 0) {
      groups.push({
        key: "audit_failures",
        title: "Failed admin actions (7d)",
        icon: "error",
        severity: "danger",
        link: "/audit-logs",
        count: failedLogCount,
        items: failedLogs.map((l) => ({
          id: l._id || l.id,
          label: `${l.action} · ${l.entityName || l.entityType}`,
          meta: l.adminEmail || l.details || "—",
          at: l.createdAt,
        })),
      });
    }

    const total = groups.reduce((acc, g) => acc + g.count, 0);

    res.json({ success: true, data: { total, groups } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
