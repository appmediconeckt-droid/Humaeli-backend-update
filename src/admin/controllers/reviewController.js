import Review from "../models/Review.js";

const getReviewText = (review) =>
  review.review ||
  review.comment ||
  review.feedback ||
  review.reviewText ||
  review.message ||
  "";

export const getAllReviews = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, rating, status } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (parsedPage - 1) * parsedLimit;

    const filter = {};

    if (rating && !Number.isNaN(Number(rating))) {
      const numericRating = Number(rating);
      filter.$or = [{ stars: numericRating }, { rating: numericRating }];
    }
    if (status) {
      if (status === "approved") {
        filter.status = { $in: ["approved", null] };
      } else {
        filter.status = status;
      }
    }
    if (search) {
      const searchFilter = [
        { review: new RegExp(search, "i") },
        { comment: new RegExp(search, "i") },
        { feedback: new RegExp(search, "i") },
        { reviewText: new RegExp(search, "i") },
        { message: new RegExp(search, "i") },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchFilter }];
        delete filter.$or;
      } else {
        filter.$or = searchFilter;
      }
    }

    const [reviews, total, average] = await Promise.all([
      Review.find(filter)
        .populate("userId", "fullName email")
        .populate("counselorId", "fullName email")
        .populate("user", "fullName email")
        .populate("counselor", "fullName email")
        .skip(skip)
        .limit(parsedLimit)
        .sort({ createdAt: -1 })
        .lean(),
      Review.countDocuments(filter),
      Review.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            avgRating: { $avg: { $ifNull: ["$stars", "$rating"] } },
          },
        },
      ]),
    ]);

    const data = reviews.map((item) => ({
      ...item,
      text: getReviewText(item),
      rating: item.stars ?? item.rating ?? 0,
      status: item.status || "approved",
      user: item.userId || item.user,
      counselor: item.counselorId || item.counselor,
    }));

    res.json({
      success: true,
      data,
      stats: {
        total,
        averageRating: Number((average[0]?.avgRating || 0).toFixed(1)),
      },
      pagination: { page: parsedPage, limit: parsedLimit, total },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
