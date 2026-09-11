import mongoose from "../../persistence/mongoose.js";
import NotificationRule, {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_CONDITIONS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
} from "../models/NotificationRule.js";
import NotificationDelivery, {
  NOTIFICATION_DELIVERY_STATUSES,
} from "../models/NotificationDelivery.js";
import { sendPromotionNotificationToMainBackend } from "../services/mainBackendNotificationClient.js";
import { processNotificationRule } from "../services/notificationRuleProcessor.js";

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 1000;
const MAX_LIMIT = 100;

const SELECTED_AUDIENCE_ID_FIELD = {
  selected_users: "selectedUserIds",
  selected_counsellors: "selectedCounsellorIds",
};

const getAdminAudit = (req) => ({
  adminId: req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id) ? req.user.id : null,
  adminEmail: req.user?.email || "",
});

const normalizeString = (value) => (typeof value === "string" ? value.trim() : value);

const validateObjectIds = (ids, fieldName) => {
  if (!Array.isArray(ids)) return `${fieldName} must be an array`;
  if (!ids.every((id) => mongoose.Types.ObjectId.isValid(id))) {
    return `${fieldName} contains an invalid ID`;
  }
  return null;
};

const validateText = (value, fieldName, maxLength) => {
  if (!value || typeof value !== "string") return `${fieldName} is required`;
  if (value.length > maxLength) return `${fieldName} must be ${maxLength} characters or fewer`;
  return null;
};

const parseBoolean = (value, defaultValue) => {
  if (value === undefined) return defaultValue;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return defaultValue;
};

const isPlainObject = (value) =>
  value === null || (typeof value === "object" && !Array.isArray(value));

const validateNotificationRulePayload = (payload) => {
  const errors = [];

  const title = normalizeString(payload.title);
  const body = normalizeString(payload.body);
  const notificationType = normalizeString(payload.notificationType);
  const audience = normalizeString(payload.audience);
  const condition = normalizeString(payload.condition || payload.ruleKey);
  const status = normalizeString(payload.status);
  const specialization = normalizeString(payload.specialization);
  const timezone = normalizeString(payload.timezone);
  const actionUrl = normalizeString(payload.actionUrl);

  const titleError = validateText(title, "title", MAX_TITLE_LENGTH);
  if (titleError) errors.push(titleError);

  const bodyError = validateText(body, "body", MAX_BODY_LENGTH);
  if (bodyError) errors.push(bodyError);

  if (!NOTIFICATION_TYPES.includes(notificationType)) {
    errors.push(`notificationType must be one of: ${NOTIFICATION_TYPES.join(", ")}`);
  }

  if (!NOTIFICATION_AUDIENCES.includes(audience)) {
    errors.push(`audience must be one of: ${NOTIFICATION_AUDIENCES.join(", ")}`);
  }

  if (!NOTIFICATION_CONDITIONS.includes(condition)) {
    errors.push(`condition must be one of: ${NOTIFICATION_CONDITIONS.join(", ")}`);
  }

  if (payload.status !== undefined && !NOTIFICATION_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${NOTIFICATION_STATUSES.join(", ")}`);
  }

  if (payload.scheduledAt !== undefined && payload.scheduledAt !== null && payload.scheduledAt !== "") {
    const scheduledAt = new Date(payload.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) errors.push("scheduledAt must be a valid date");
  }

  if (payload.timezone !== undefined && typeof timezone !== "string") errors.push("timezone must be a string");
  if (payload.specialization !== undefined && typeof specialization !== "string") errors.push("specialization must be a string");
  if (payload.actionUrl !== undefined && typeof actionUrl !== "string") errors.push("actionUrl must be a string");
  if (payload.data !== undefined && !isPlainObject(payload.data)) errors.push("data must be an object");

  const selectedFieldName = SELECTED_AUDIENCE_ID_FIELD[audience];
  if (selectedFieldName) {
    const selectedIds = payload[selectedFieldName];
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
      errors.push(`${selectedFieldName} must contain at least one ID when audience is "${audience}"`);
    } else {
      const idError = validateObjectIds(selectedIds, selectedFieldName);
      if (idError) errors.push(idError);
    }
  }

  if (payload.selectedUserIds !== undefined) {
    const idError = validateObjectIds(payload.selectedUserIds, "selectedUserIds");
    if (idError) errors.push(idError);
  }

  if (payload.selectedCounsellorIds !== undefined) {
    const idError = validateObjectIds(payload.selectedCounsellorIds, "selectedCounsellorIds");
    if (idError) errors.push(idError);
  }

  return {
    errors,
    data: {
      title,
      body,
      notificationType,
      audience,
      condition,
      selectedUserIds: payload.selectedUserIds || [],
      selectedCounsellorIds: payload.selectedCounsellorIds || [],
      specialization: specialization || "",
      status: status || "inactive",
      scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt) : null,
      timezone: timezone || "",
      sendImmediately: Boolean(payload.sendImmediately),
      actionUrl: actionUrl || "",
      data: payload.data || {},
    },
  };
};

const cleanAudienceSelections = (data) => {
  if (data.audience === "all_users" || data.audience === "all_counsellors") {
    data.selectedUserIds = [];
    data.selectedCounsellorIds = [];
  }
  if (data.audience === "selected_users") data.selectedCounsellorIds = [];
  if (data.audience === "selected_counsellors") data.selectedUserIds = [];
  return data;
};

const normalizePromotionPayload = (body) => {
  const errors = [];
  const title = normalizeString(body.title);
  const messageBody = normalizeString(body.body);
  const notificationType = normalizeString(body.notificationType || "promotion");
  const actionUrl = normalizeString(body.actionUrl);
  const legacyTarget = normalizeString(body.target);
  const legacyUserIds = body.userIds || [];
  let audience = normalizeString(body.audience);

  if (!audience) {
    if (legacyTarget === "all") audience = "all_users";
    if (legacyTarget === "selected") audience = "selected_users";
  }

  const titleError = validateText(title, "title", MAX_TITLE_LENGTH);
  if (titleError) errors.push(titleError);

  const bodyError = validateText(messageBody, "body", MAX_BODY_LENGTH);
  if (bodyError) errors.push(bodyError);

  if (!NOTIFICATION_TYPES.includes(notificationType)) {
    errors.push(`notificationType must be one of: ${NOTIFICATION_TYPES.join(", ")}`);
  }

  if (!NOTIFICATION_AUDIENCES.includes(audience)) {
    errors.push(`audience must be one of: ${NOTIFICATION_AUDIENCES.join(", ")}`);
  }

  if (body.data !== undefined && !isPlainObject(body.data)) errors.push("data must be an object");
  if (body.actionUrl !== undefined && typeof actionUrl !== "string") errors.push("actionUrl must be a string");

  const selectedUserIds = audience === "selected_users"
    ? body.selectedUserIds || legacyUserIds
    : [];
  const selectedCounsellorIds = audience === "selected_counsellors"
    ? body.selectedCounsellorIds || []
    : [];

  if (audience === "selected_users") {
    if (!Array.isArray(selectedUserIds) || selectedUserIds.length === 0) {
      errors.push("selectedUserIds must contain at least one ID");
    } else {
      const idError = validateObjectIds(selectedUserIds, "selectedUserIds");
      if (idError) errors.push(idError);
    }
  }

  if (audience === "selected_counsellors") {
    if (!Array.isArray(selectedCounsellorIds) || selectedCounsellorIds.length === 0) {
      errors.push("selectedCounsellorIds must contain at least one ID");
    } else {
      const idError = validateObjectIds(selectedCounsellorIds, "selectedCounsellorIds");
      if (idError) errors.push(idError);
    }
  }

  return {
    errors,
    data: {
      title,
      body: messageBody,
      notificationType,
      actionUrl: actionUrl || "",
      data: body.data || {},
      audience,
      selectedUserIds,
      selectedCounsellorIds,
      target: audience === "all_users" ? "all" : "selected",
      userIds: audience === "selected_users" ? selectedUserIds : [],
    },
  };
};

const getSafeError = (err) =>
  process.env.NODE_ENV === "development" ? err.message : undefined;

export const sendPromotionNotification = async (req, res) => {
  try {
    const { errors, data } = normalizePromotionPayload(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: "Validation failed", errors });
    }

    const payload = {
      title: data.title,
      body: data.body,
      notificationType: data.notificationType,
      actionUrl: data.actionUrl,
      data: data.data,
      target: data.target,
      userIds: data.userIds,
      audience: data.audience,
      selectedUserIds: data.selectedUserIds,
      selectedCounsellorIds: data.selectedCounsellorIds,
    };

    if (data.audience === "all_users") {
      payload.target = "all";
      payload.userIds = [];
    }

    const result = await sendPromotionNotificationToMainBackend(payload);
    if (!result.success) {
      return res.status(result.status || 502).json({
        success: false,
        message: "Main Backend failed to send promotion notification",
        data: {
          audience: data.audience,
          mainBackendStatus: result.status,
          error: result.error,
        },
      });
    }

    return res.status(result.status || 200).json({
      success: true,
      message: "Promotion notification request sent to Main Backend",
      data: {
        audience: data.audience,
        selectedUserCount: data.selectedUserIds.length,
        selectedCounsellorCount: data.selectedCounsellorIds.length,
        mainBackendStatus: result.status,
        mainBackendResponse: result.body,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to process promotion notification request",
      error: getSafeError(err),
    });
  }
};

export const createNotificationRule = async (req, res) => {
  try {
    const { errors, data } = validateNotificationRulePayload(req.body);
    if (errors.length > 0) return res.status(400).json({ success: false, message: "Validation failed", errors });

    const audit = getAdminAudit(req);
    const notificationRule = await NotificationRule.create({
      ...cleanAudienceSelections(data),
      createdBy: audit,
      updatedBy: audit,
    });

    return res.status(201).json({
      success: true,
      message: "Notification rule created successfully",
      data: notificationRule,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to create notification rule", error: getSafeError(err) });
  }
};

export const getNotificationRules = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      notificationType,
      audience,
      condition,
      specialization,
    } = req.query;
    const parsedPage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), MAX_LIMIT);
    const skip = (parsedPage - 1) * parsedLimit;
    const filter = {};

    if (status) filter.status = status;
    if (notificationType) filter.notificationType = notificationType;
    if (audience) filter.audience = audience;
    if (condition) filter.condition = condition;
    if (specialization) filter.specialization = specialization;

    const [notificationRules, total] = await Promise.all([
      NotificationRule.find(filter).skip(skip).limit(parsedLimit).sort({ createdAt: -1 }),
      NotificationRule.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: notificationRules,
      pagination: { page: parsedPage, limit: parsedLimit, total },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to get notification rules", error: getSafeError(err) });
  }
};

export const getActiveNotificationRulesForInternalJob = async (_req, res) => {
  try {
    const notificationRules = await NotificationRule.find({ status: "active" }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: notificationRules });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to get active notification rules", error: getSafeError(err) });
  }
};

export const getNotificationRuleById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid notification rule ID" });
    }

    const notificationRule = await NotificationRule.findById(req.params.id);
    if (!notificationRule) return res.status(404).json({ success: false, message: "Notification rule not found" });

    return res.json({ success: true, data: notificationRule });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to get notification rule", error: getSafeError(err) });
  }
};

export const updateNotificationRule = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid notification rule ID" });
    }

    const existingRule = await NotificationRule.findById(req.params.id);
    if (!existingRule) return res.status(404).json({ success: false, message: "Notification rule not found" });

    const mergedPayload = { ...existingRule.toObject(), ...req.body };
    const { errors, data } = validateNotificationRulePayload(mergedPayload);
    if (errors.length > 0) return res.status(400).json({ success: false, message: "Validation failed", errors });

    Object.assign(existingRule, cleanAudienceSelections(data), { updatedBy: getAdminAudit(req) });
    if (req.body.sendImmediately === true) {
      existingRule.lastProcessedAt = null;
    }
    await existingRule.save();

    return res.json({
      success: true,
      message: "Notification rule updated successfully",
      data: existingRule,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to update notification rule", error: getSafeError(err) });
  }
};

export const deleteNotificationRule = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid notification rule ID" });
    }

    const notificationRule = await NotificationRule.findByIdAndDelete(req.params.id);
    if (!notificationRule) return res.status(404).json({ success: false, message: "Notification rule not found" });

    return res.json({ success: true, message: "Notification rule deleted successfully" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to delete notification rule", error: getSafeError(err) });
  }
};

export const setNotificationRuleStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid notification rule ID" });
    }

    const { status, enabled } = req.body;
    const nextStatus = status || (enabled === true ? "active" : enabled === false ? "inactive" : undefined);

    if (!NOTIFICATION_STATUSES.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${NOTIFICATION_STATUSES.join(", ")}`,
      });
    }

    const notificationRule = await NotificationRule.findByIdAndUpdate(
      req.params.id,
      { status: nextStatus, updatedBy: getAdminAudit(req) },
      { new: true },
    );

    if (!notificationRule) return res.status(404).json({ success: false, message: "Notification rule not found" });

    return res.json({
      success: true,
      message: `Notification rule ${nextStatus === "active" ? "enabled" : "disabled"} successfully`,
      data: notificationRule,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to update notification rule status", error: getSafeError(err) });
  }
};

export const previewNotificationRule = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid notification rule ID" });
    }

    const rule = await NotificationRule.findById(req.params.id).lean();
    if (!rule) return res.status(404).json({ success: false, message: "Notification rule not found" });

    const result = await processNotificationRule(rule, { dryRun: true });
    return res.json({
      success: true,
      data: {
        matchedCount: result.matchedCount,
        skippedReason: result.skippedReason,
        matchedRecipients: result.matchedRecipients,
        wouldSend: result.wouldSend,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to preview notification rule", error: getSafeError(err) });
  }
};

export const testNotificationRule = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid notification rule ID" });
    }

    const rule = await NotificationRule.findById(req.params.id).lean();
    if (!rule) return res.status(404).json({ success: false, message: "Notification rule not found" });

    const dryRun = parseBoolean(req.body?.dryRun, true);
    const result = await processNotificationRule(rule, { dryRun });
    return res.json({
      success: !result.error,
      message: dryRun ? "Notification rule test completed in dry-run mode" : "Notification rule test executed",
      data: result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to test notification rule", error: getSafeError(err) });
  }
};

export const getNotificationDeliveries = async (req, res) => {
  try {
    const { status, ruleId, recipientId, from, to, page = 1, limit = 20 } = req.query;
    const parsedPage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), MAX_LIMIT);
    const filter = {};
    const errors = [];

    if (status) {
      if (!NOTIFICATION_DELIVERY_STATUSES.includes(status)) errors.push(`status must be one of: ${NOTIFICATION_DELIVERY_STATUSES.join(", ")}`);
      else filter.status = status;
    }
    if (ruleId) {
      if (!mongoose.Types.ObjectId.isValid(ruleId)) errors.push("ruleId must be a valid ID");
      else filter.ruleId = ruleId;
    }
    if (recipientId) {
      if (!mongoose.Types.ObjectId.isValid(recipientId)) errors.push("recipientId must be a valid ID");
      else filter.recipientId = recipientId;
    }
    if (from || to) {
      filter.createdAt = {};
      if (from) {
        const fromDate = new Date(from);
        if (Number.isNaN(fromDate.getTime())) errors.push("from must be a valid date");
        else filter.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (Number.isNaN(toDate.getTime())) errors.push("to must be a valid date");
        else filter.createdAt.$lte = toDate;
      }
    }

    if (errors.length > 0) return res.status(400).json({ success: false, message: "Validation failed", errors });

    const [deliveries, total] = await Promise.all([
      NotificationDelivery.find(filter)
        .populate("recipientId", "fullName email role")
        .populate("ruleId", "title condition audience notificationType status")
        .sort({ createdAt: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        .lean(),
      NotificationDelivery.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: deliveries,
      pagination: { page: parsedPage, limit: parsedLimit, total },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to get notification deliveries", error: getSafeError(err) });
  }
};

export const getNotificationDeliveryById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid notification delivery ID" });
    }

    const delivery = await NotificationDelivery.findById(req.params.id)
      .populate("recipientId", "fullName email role")
      .populate("ruleId", "title condition audience notificationType status")
      .lean();

    if (!delivery) return res.status(404).json({ success: false, message: "Notification delivery not found" });

    return res.json({ success: true, data: delivery });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to get notification delivery", error: getSafeError(err) });
  }
};
