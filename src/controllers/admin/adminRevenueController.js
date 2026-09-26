// src/controllers/admin/adminRevenueController.js
import CounselorEarning from "../../models/mysql/CounselorEarningModel.js";
import User from "../../models/userModel.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const getCounselorRevenue = async (req, res) => {
  try {
    const earnings = await CounselorEarning.find({
      earningStatus: { $in: ["completed", null, undefined] },
    });

    // Group by counselorId
    const grouped = {};
    for (const e of earnings) {
      const cid = String(e.counselorId || "unknown");
      if (!grouped[cid]) {
        grouped[cid] = { counselorId: cid, totalSessions: 0, totalRevenue: 0, platformFee: 0, counselorEarnings: 0 };
      }
      grouped[cid].totalSessions++;
      grouped[cid].totalRevenue += Number(e.totalAmount) || 0;
      grouped[cid].platformFee += Number(e.commission) || 0;
      grouped[cid].counselorEarnings += Number(e.earningAmount) || 0;
    }

    const counselorIds = Object.keys(grouped);
    const users = await User.find({ _id: { $in: counselorIds } });
    const userMap = new Map(users.map((u) => [String(u._id || u.id), u]));

    const data = Object.values(grouped)
      .map((g) => {
        const user = userMap.get(g.counselorId);
        return {
          counselorId: g.counselorId,
          counselorName: user?.fullName || "Unknown",
          counselorEmail: user?.email || "",
          totalSessions: g.totalSessions,
          totalRevenue: round2(g.totalRevenue),
          platformFee: round2(g.platformFee),
          counselorEarnings: round2(g.counselorEarnings),
          avgTransactionAmount: round2(g.totalSessions > 0 ? g.totalRevenue / g.totalSessions : 0),
          platformPercentage: g.totalRevenue > 0 ? round2((g.platformFee / g.totalRevenue) * 100) : 0,
          counselorPercentage: g.totalRevenue > 0 ? round2((g.counselorEarnings / g.totalRevenue) * 100) : 0,
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error("Error in getCounselorRevenue:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getRevenueBySessionType = async (req, res) => {
  try {
    const earnings = await CounselorEarning.find({
      earningStatus: { $in: ["completed", null, undefined] },
    });

    const grouped = {};
    for (const e of earnings) {
      const type = e.sessionType || "unknown";
      if (!grouped[type]) {
        grouped[type] = { sessionType: type, count: 0, totalRevenue: 0, platformFee: 0, counselorEarnings: 0 };
      }
      grouped[type].count++;
      grouped[type].totalRevenue += Number(e.totalAmount) || 0;
      grouped[type].platformFee += Number(e.commission) || 0;
      grouped[type].counselorEarnings += Number(e.earningAmount) || 0;
    }

    const data = Object.values(grouped)
      .map((g) => ({
        ...g,
        totalRevenue: round2(g.totalRevenue),
        platformFee: round2(g.platformFee),
        counselorEarnings: round2(g.counselorEarnings),
        avgAmount: round2(g.count > 0 ? g.totalRevenue / g.count : 0),
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    res.json({ success: true, data });
  } catch (err) {
    console.error("Error in getRevenueBySessionType:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getTopCounselors = async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const earnings = await CounselorEarning.find({
      earningStatus: { $in: ["completed", null, undefined] },
    });

    const grouped = {};
    for (const e of earnings) {
      const cid = String(e.counselorId || "unknown");
      if (!grouped[cid]) {
        grouped[cid] = { counselorId: cid, totalSessions: 0, totalRevenue: 0, counselorEarnings: 0 };
      }
      grouped[cid].totalSessions++;
      grouped[cid].totalRevenue += Number(e.totalAmount) || 0;
      grouped[cid].counselorEarnings += Number(e.earningAmount) || 0;
    }

    const topIds = Object.values(grouped)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, parseInt(limit));

    const users = await User.find({ _id: { $in: topIds.map((g) => g.counselorId) } });
    const userMap = new Map(users.map((u) => [String(u._id || u.id), u]));

    const data = topIds.map((g) => ({
      ...g,
      counselorName: userMap.get(g.counselorId)?.fullName || "Unknown",
      totalRevenue: round2(g.totalRevenue),
      counselorEarnings: round2(g.counselorEarnings),
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error("Error in getTopCounselors:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getCounselorDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const earnings = await CounselorEarning.find({
      counselorId: id,
      earningStatus: { $in: ["completed", null, undefined] },
    });

    if (earnings.length === 0) {
      return res.json({
        success: true,
        data: { counselorId: id, totalSessions: 0, totalRevenue: 0, counselorEarnings: 0, platformFee: 0 },
      });
    }

    const totalRevenue = earnings.reduce((s, e) => s + (Number(e.totalAmount) || 0), 0);
    const platformFee = earnings.reduce((s, e) => s + (Number(e.commission) || 0), 0);
    const counselorEarnings = earnings.reduce((s, e) => s + (Number(e.earningAmount) || 0), 0);
    const avgAmount = totalRevenue / earnings.length;

    const counselor = await User.findById(id);

    res.json({
      success: true,
      data: {
        counselorId: id,
        counselorName: counselor?.fullName || "Unknown",
        counselorEmail: counselor?.email || "",
        totalSessions: earnings.length,
        totalRevenue: round2(totalRevenue),
        platformFee: round2(platformFee),
        counselorEarnings: round2(counselorEarnings),
        avgAmount: round2(avgAmount),
      },
    });
  } catch (err) {
    console.error("Error in getCounselorDetails:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
