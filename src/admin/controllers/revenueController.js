import mongoose from "../../persistence/mongoose.js";
import CounselorEarning from "../models/CounselorEarning.js";

// Get revenue per counselor
export const getCounselorRevenue = async (req, res) => {
  try {
    const data = await CounselorEarning.aggregate([
      { $match: { $or: [{ earningStatus: "completed" }, { earningStatus: { $exists: false } }] } },
      {
        $group: {
          _id: "$counselorId",
          totalSessions: { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
          platformFee: { $sum: { $ifNull: ["$commission", 0] } },
          counselorEarnings: { $sum: { $ifNull: ["$earningAmount", 0] } },
          avgTransactionAmount: { $avg: { $ifNull: ["$totalAmount", 0] } }
        }
      },
      // Join with counselor details
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "counselorDetails"
        }
      },
      // Unwind counselor details
      { $unwind: { path: "$counselorDetails", preserveNullAndEmptyArrays: true } },
      // Project final fields
      {
        $project: {
          _id: 0,
          counselorId: "$_id",
          counselorName: {
            $cond: [
              { $ifNull: ["$counselorDetails.fullName", null] },
              "$counselorDetails.fullName",
              "Unknown"
            ]
          },
          counselorEmail: "$counselorDetails.email",
          totalSessions: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
          platformFee: { $round: ["$platformFee", 2] },
          counselorEarnings: { $round: ["$counselorEarnings", 2] },
          avgTransactionAmount: { $round: ["$avgTransactionAmount", 2] },
          platformPercentage: {
            $cond: [
              { $eq: ["$totalRevenue", 0] },
              0,
              { $round: [{ $multiply: [{ $divide: ["$platformFee", "$totalRevenue"] }, 100] }, 2] }
            ]
          },
          counselorPercentage: {
            $cond: [
              { $eq: ["$totalRevenue", 0] },
              0,
              { $round: [{ $multiply: [{ $divide: ["$counselorEarnings", "$totalRevenue"] }, 100] }, 2] }
            ]
          }
        }
      },
      // Sort by revenue descending
      { $sort: { totalRevenue: -1 } }
    ]);

    res.json({
      success: true,
      count: data.length,
      data: data
    });
  } catch (err) {
    console.error("Error in getCounselorRevenue:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// Get revenue by session type
export const getRevenueBySessionType = async (req, res) => {
  try {
    const data = await CounselorEarning.aggregate([
      { $match: { $or: [{ earningStatus: "completed" }, { earningStatus: { $exists: false } }] } },
      {
        $group: {
          _id: "$sessionType",
          count: { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
          platformFee: { $sum: { $ifNull: ["$commission", 0] } },
          counselorEarnings: { $sum: { $ifNull: ["$earningAmount", 0] } },
          avgAmount: { $avg: { $ifNull: ["$totalAmount", 0] } }
        }
      },
      {
        $project: {
          sessionType: "$_id",
          _id: 0,
          count: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
          platformFee: { $round: ["$platformFee", 2] },
          counselorEarnings: { $round: ["$counselorEarnings", 2] },
          avgAmount: { $round: ["$avgAmount", 2] }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    res.json({
      success: true,
      data: data
    });
  } catch (err) {
    console.error("Error in getRevenueBySessionType:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// Get top counselors (quick view)
export const getTopCounselors = async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    const data = await CounselorEarning.aggregate([
      { $match: { $or: [{ earningStatus: "completed" }, { earningStatus: { $exists: false } }] } },
      {
        $group: {
          _id: "$counselorId",
          totalSessions: { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
          counselorEarnings: { $sum: { $ifNull: ["$earningAmount", 0] } }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "counselorDetails"
        }
      },
      { $unwind: { path: "$counselorDetails", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          counselorId: "$_id",
          counselorName: "$counselorDetails.fullName",
          totalSessions: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
          counselorEarnings: { $round: ["$counselorEarnings", 2] }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.json({
      success: true,
      data: data
    });
  } catch (err) {
    console.error("Error in getTopCounselors:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// Get counselor specific details
export const getCounselorDetails = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: "Invalid counselor id" });
    }

    const data = await CounselorEarning.aggregate([
      { $match: { counselorId: new mongoose.Types.ObjectId(id), $or: [{ earningStatus: "completed" }, { earningStatus: { $exists: false } }] } },
      {
        $group: {
          _id: "$counselorId",
          totalSessions: { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
          platformFee: { $sum: { $ifNull: ["$commission", 0] } },
          counselorEarnings: { $sum: { $ifNull: ["$earningAmount", 0] } },
          avgAmount: { $avg: { $ifNull: ["$totalAmount", 0] } }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "counselorDetails"
        }
      },
      { $unwind: "$counselorDetails" }
    ]);

    if (data.length === 0) {
      return res.json({
        success: true,
        data: {
          counselorId: id,
          totalSessions: 0,
          totalRevenue: 0,
          counselorEarnings: 0,
          platformFee: 0
        }
      });
    }

    res.json({
      success: true,
      data: data[0]
    });
  } catch (err) {
    console.error("Error in getCounselorDetails:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
