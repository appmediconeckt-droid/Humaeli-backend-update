import User from "../models/User.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const SUPPORTED_RULE_CONDITIONS = [
  "inactive_2_days",
  "inactive_5_7_days",
  "counsellor_inactive",
  "scheduled_promotion",
];

export const tokenFilter = {
  fcmToken: { $exists: true, $type: "string", $nin: [null, ""], $regex: /\S/ },
};

const isValidDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
};

export const getInactiveFiveToSevenDayWindow = (now = new Date()) => {
  const end = new Date(now.getTime() - 5 * DAY_MS);
  const start = new Date(now.getTime() - 7 * DAY_MS);

  return { start, end };
};

export const getInactiveTwoDayWindow = (now = new Date()) => {
  const end = new Date(now.getTime() - 2 * DAY_MS);
  const start = new Date(now.getTime() - 5 * DAY_MS);

  return { start, end };
};

export const getInactivityAgeDays = (lastActiveAt, now = new Date()) => {
  if (!isValidDate(lastActiveAt)) return null;
  return (now.getTime() - new Date(lastActiveAt).getTime()) / DAY_MS;
};

const toSafeRecipient = (recipient, now) => ({
  recipientId: String(recipient._id),
  fullName: recipient.fullName || "",
  email: recipient.email || "",
  role: recipient.role,
  lastActiveAt: recipient.lastSeen,
  hasFcmToken: Boolean(recipient.fcmToken && String(recipient.fcmToken).trim()),
  inactivityAgeDays: getInactivityAgeDays(recipient.lastSeen, now),
});

const applySelectedAudience = (query, ids) => {
  query._id = { $in: ids || [] };
};

export const matchRuleRecipients = async (rule, now = new Date()) => {
  const summary = {
    ruleId: String(rule?._id || ""),
    condition: rule?.condition || "",
    matchedRecipients: [],
    skippedReason: null,
  };

  if (!SUPPORTED_RULE_CONDITIONS.includes(rule?.condition)) {
    summary.skippedReason = "unsupported_condition";
    return summary;
  }

  const query = {
    isActive: true,
    ...tokenFilter,
    lastSeen: {
      $exists: true,
      $type: "date",
    },
  };

  if (rule.condition === "inactive_2_days") {
    if (!["all_users", "selected_users"].includes(rule.audience)) {
      summary.skippedReason = "unsupported_audience_for_user_inactivity";
      return summary;
    }

    const { start, end } = getInactiveTwoDayWindow(now);
    query.role = "user";
    query.lastSeen.$gt = start;
    query.lastSeen.$lte = end;

    if (rule.audience === "selected_users") {
      applySelectedAudience(query, rule.selectedUserIds);
    }
  }

  if (rule.condition === "inactive_5_7_days") {
    if (!["all_users", "selected_users"].includes(rule.audience)) {
      summary.skippedReason = "unsupported_audience_for_user_inactivity";
      return summary;
    }

    const { start, end } = getInactiveFiveToSevenDayWindow(now);
    query.role = "user";
    query.lastSeen.$gt = start;
    query.lastSeen.$lte = end;

    if (rule.audience === "selected_users") {
      applySelectedAudience(query, rule.selectedUserIds);
    }
  }

  if (rule.condition === "counsellor_inactive") {
    if (!["all_counsellors", "selected_counsellors"].includes(rule.audience)) {
      summary.skippedReason = "unsupported_audience_for_counsellor_inactivity";
      return summary;
    }

    const { end } = getInactiveTwoDayWindow(now);
    query.role = "counsellor";
    query.lastSeen.$lte = end;

    if (rule.audience === "selected_counsellors") {
      applySelectedAudience(query, rule.selectedCounsellorIds);
    }
  }

  if (rule.condition === "scheduled_promotion") {
    if (!["all_users", "selected_users", "all_counsellors", "selected_counsellors"].includes(rule.audience)) {
      summary.skippedReason = "unsupported_audience_for_scheduled_promotion";
      return summary;
    }

    delete query.lastSeen;
    query.role = rule.audience.includes("counsellor") ? "counsellor" : "user";

    if (rule.audience === "selected_users") {
      applySelectedAudience(query, rule.selectedUserIds);
    }

    if (rule.audience === "selected_counsellors") {
      applySelectedAudience(query, rule.selectedCounsellorIds);
    }
  }

  const users = await User.find(query)
    .select("_id fullName email role fcmToken lastSeen")
    .lean();

  summary.matchedRecipients = users
    .filter((user) => isValidDate(user.lastSeen))
    .map((user) => toSafeRecipient(user, now));

  if (rule.condition === "scheduled_promotion") {
    summary.matchedRecipients = users.map((user) => toSafeRecipient(user, now));
  }

  return summary;
};

export const matchInactiveUsers = async (rule, now = new Date()) => {
  const summary = await matchRuleRecipients(rule, now);

  return {
    ...summary,
    matchedUsers: summary.matchedRecipients.map((recipient) => ({
      userId: recipient.recipientId,
      lastActiveAt: recipient.lastSeen,
      hasFcmToken: recipient.hasFcmToken,
      inactivityAgeDays: recipient.inactivityAgeDays,
    })),
  };
};
