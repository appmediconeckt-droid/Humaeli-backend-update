// src/controllers/admin/adminReviewController.js
import Review from "../../models/mysql/ReviewModel.js";
import User from "../../models/userModel.js";

const getReviewText = (review) =>
  review.review || review.comment || review.feedback || review.reviewText || review.message || "";

export const getAllReviews = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, rating, status } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (parsedPage - 1) * parsedLimit;

    let filter = {};
    if (rating && !Number.isNaN(Number(rating))) {
      filter.stars = Number(rating);
    }
    if (status) {
      filter.status = status;
    }

    let allReviews = await Review.find(filter).sort({ createdAt: -1 });
    const total = allReviews.length;

    // In-memory search since MySQL BaseModel doesn't support $regex
    if (search) {
      const lowerSearch = search.toLowerCase();
      allReviews = allReviews.filter((r) => {
        const text = getReviewText(r).toLowerCase();
        return text.includes(lowerSearch);
      });
    }

    const paged = allReviews.slice(skip, skip + parsedLimit);

    // Fetch user and counselor details
    const userIds = [...new Set(paged.map((r) => r.userId).filter(Boolean))];
    const counselorIds = [...new Set(paged.map((r) => r.counselorId).filter(Boolean))];

    const [users, counselors] = await Promise.all([
      userIds.length > 0 ? User.find({ _id: { $in: userIds } }) : [],
      counselorIds.length > 0 ? User.find({ _id: { $in: counselorIds } }) : [],
    ]);

    const userMap = new Map(users.map((u) => [String(u._id || u.id), u]));
    const counselorMap = new Map(counselors.map((c) => [String(c._id || c.id), c]));

    const avgRating =
      allReviews.length > 0
        ? allReviews.reduce((sum, r) => sum + (Number(r.stars) || Number(r.rating) || 0), 0) / allReviews.length
        : 0;

    const data = paged.map((item) => ({
      ...item,
      text: getReviewText(item),
      rating: item.stars ?? item.rating ?? 0,
      status: item.status || "approved",
      user: userMap.get(String(item.userId)) || null,
      counselor: counselorMap.get(String(item.counselorId)) || null,
    }));

    res.json({
      success: true,
      data,
      stats: {
        total: allReviews.length,
        averageRating: Number(avgRating.toFixed(1)),
      },
      pagination: { page: parsedPage, limit: parsedLimit, total: allReviews.length },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
