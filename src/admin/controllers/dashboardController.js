import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import Transaction from "../models/Transaction.js";
import Payout from "../models/Payout.js";
import CounselorEarning from "../models/CounselorEarning.js";
import SupportTicket from "../models/SupportTicket.js";

export const getDashboardAnalytics = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: "user" });
    const totalCounselors = await User.countDocuments({ role: "counsellor" });
    const verifiedUsers = await User.countDocuments({ role: "user", isVerified: true });
    const verifiedCounselors = await User.countDocuments({ role: "counsellor", isVerified: true });
    const activeUsers = await User.countDocuments({ role: "user", isActive: true });
    const activeCounselors = await User.countDocuments({ role: "counsellor", isActive: true });

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
        verificationRateCounselors: totalCounselors > 0 ? ((verifiedCounselors / totalCounselors) * 100).toFixed(2) : 0
      }
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

      const userCount = await User.countDocuments({
        role: "user",
        createdAt: { $gte: date, $lt: nextDate }
      });

      const counselorCount = await User.countDocuments({
        role: "counsellor",
        createdAt: { $gte: date, $lt: nextDate }
      });

      data.push({
        date: date.toLocaleDateString(),
        users: userCount,
        counselors: counselorCount
      });
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
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getRecentActivities = async (req, res) => {
  try {
    const recentUsers = await User.find({ role: "user" })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("fullName email createdAt");

    const recentCounselors = await User.find({ role: "counsellor" })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("fullName email createdAt");

    res.json({
      success: true,
      data: {
        recentUsers,
        recentCounselors
      }
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

    const [earningsTotals, thisMonthRevenue] = await Promise.all([
      CounselorEarning.aggregate([
        { $match: { $or: [{ earningStatus: "completed" }, { earningStatus: { $exists: false } }] } },
        { $group: {
        _id: null,
        totalRevenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
        platformEarnings: { $sum: { $ifNull: ["$commission", 0] } },
        counselorEarnings: { $sum: { $ifNull: ["$earningAmount", 0] } }
      } }]),
      CounselorEarning.aggregate([
        { $match: { createdAt: { $gte: startOfMonth }, $or: [{ earningStatus: "completed" }, { earningStatus: { $exists: false } }] } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$totalAmount", 0] } } } }
      ])
    ]);

    const completedStatus = { $regex: /^completed$/i };
    const failedStatus = { $regex: /^failed$/i };
    const refundedStatus = { $regex: /^refunded$/i };
    const totalTransactions = await Transaction.countDocuments({ status: completedStatus });
    const failedTransactions = await Transaction.countDocuments({ status: failedStatus });
    const refundedAmount = await Transaction.aggregate([
      { $match: { status: refundedStatus } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    res.json({
      success: true,
      data: {
        totalRevenue: earningsTotals[0]?.totalRevenue || 0,
        platformEarnings: earningsTotals[0]?.platformEarnings || 0,
        counselorEarnings: earningsTotals[0]?.counselorEarnings || 0,
        thisMonthRevenue: thisMonthRevenue[0]?.total || 0,
        totalTransactions,
        failedTransactions,
        refundedAmount: refundedAmount[0]?.total || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getRevenueTimeSeries = async (req, res) => {
  try {
    const data = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const revenue = await CounselorEarning.aggregate([
        {
          $match: {
            createdAt: { $gte: date, $lt: nextDate },
            $or: [{ earningStatus: "completed" }, { earningStatus: { $exists: false } }]
          }
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$totalAmount", 0] } } } }
      ]);

      data.push({
        date: date.toLocaleDateString(),
        revenue: revenue[0]?.total || 0
      });
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

    const logs = await AuditLog.find(filter)
      .populate("adminId", "fullName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await AuditLog.countDocuments(filter);

    res.json({
      success: true,
      data: logs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total }
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
      pendingPayoutTotal,
      newUsersToday,
      newUserCount,
      failedLogs,
      failedLogCount
    ] = await Promise.all([
      User.find({ role: "counsellor", isVerified: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("fullName email createdAt"),
      User.countDocuments({ role: "counsellor", isVerified: false }),

      Payout.find({ status: "PENDING" })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("payoutId counselorName amount currency createdAt"),
      Payout.countDocuments({ status: "PENDING" }),
      Payout.aggregate([
        { $match: { status: "PENDING" } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),

      User.find({ role: "user", createdAt: { $gte: since24h } })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("fullName email createdAt"),
      User.countDocuments({ role: "user", createdAt: { $gte: since24h } }),

      AuditLog.find({ status: "FAILURE", createdAt: { $gte: since7d } })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("action entityType entityName adminEmail details createdAt"),
      AuditLog.countDocuments({ status: "FAILURE", createdAt: { $gte: since7d } })
    ]);

    const groups = [];

    const [unreadSupportTickets, unreadSupportCount] = await Promise.all([
      SupportTicket.find({ unreadByAdmin: true }).sort({ lastMessageAt: -1 }).limit(5).select("ticketNumber requesterName requesterEmail subject lastMessageAt"),
      SupportTicket.countDocuments({ unreadByAdmin: true })
    ]);

    if (unreadSupportCount > 0) {
      groups.push({
        key: "support_unread",
        title: "New support messages",
        icon: "support_agent",
        severity: "warning",
        link: "/support",
        count: unreadSupportCount,
        items: unreadSupportTickets.map(ticket => ({
          id: ticket._id,
          label: ticket.requesterName || ticket.requesterEmail,
          meta: ticket.subject,
          at: ticket.lastMessageAt
        }))
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
        items: pendingCounselors.map(c => ({
          id: c._id,
          label: c.fullName || "Unnamed counselor",
          meta: c.email,
          at: c.createdAt
        }))
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
        totalAmount: pendingPayoutTotal[0]?.total || 0,
        items: pendingPayouts.map(p => ({
          id: p._id,
          label: p.counselorName || p.payoutId,
          meta: `${p.currency || "USD"} ${p.amount?.toLocaleString?.() || p.amount}`,
          at: p.createdAt
        }))
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
        items: newUsersToday.map(u => ({
          id: u._id,
          label: u.fullName || "Unnamed user",
          meta: u.email,
          at: u.createdAt
        }))
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
        items: failedLogs.map(l => ({
          id: l._id,
          label: `${l.action} · ${l.entityName || l.entityType}`,
          meta: l.adminEmail || l.details || "—",
          at: l.createdAt
        }))
      });
    }

    const total = groups.reduce((acc, g) => acc + g.count, 0);

    res.json({ success: true, data: { total, groups } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
