import mongoose from "../../persistence/mongoose.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { matchRuleRecipients, SUPPORTED_RULE_CONDITIONS } from "./notificationRecipientMatcher.js";
import { sendPromotionNotificationToMainBackend } from "./mainBackendNotificationClient.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const toDateKey = (date) => date.toISOString().slice(0, 10);

const validateSelectedAudience = (rule) => {
  if (rule.audience === "selected_users") {
    const ids = rule.selectedUserIds || [];
    if (!Array.isArray(ids) || ids.length === 0) return "selectedUserIds_required";
    if (!ids.every((id) => mongoose.Types.ObjectId.isValid(id))) return "invalid_selectedUserIds";
  }

  if (rule.audience === "selected_counsellors") {
    const ids = rule.selectedCounsellorIds || [];
    if (!Array.isArray(ids) || ids.length === 0) return "selectedCounsellorIds_required";
    if (!ids.every((id) => mongoose.Types.ObjectId.isValid(id))) return "invalid_selectedCounsellorIds";
  }

  return null;
};

const isScheduledPromotionDue = (rule, now) => {
  if (rule.condition !== "scheduled_promotion") return true;
  if (rule.sendImmediately === true) return true;
  if (!rule.scheduledAt) return false;

  const scheduledAt = new Date(rule.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return false;

  return scheduledAt.getTime() <= now.getTime();
};

const getRulePeriodKey = (rule, recipient, now) => {
  if (rule.condition === "inactive_2_days") {
    return `last_active_${toDateKey(new Date(recipient.lastActiveAt))}`;
  }

  if (rule.condition === "inactive_5_7_days") {
    return `last_active_${toDateKey(new Date(recipient.lastActiveAt))}`;
  }

  if (rule.condition === "counsellor_inactive") {
    const ageDays = Math.floor(Number(recipient.inactivityAgeDays || 0));
    const cycleStart = new Date(now.getTime() - (ageDays % 7) * DAY_MS);
    return `weekly_${toDateKey(cycleStart)}`;
  }

  if (rule.condition === "scheduled_promotion") {
    if (rule.scheduledAt) return `scheduled_${new Date(rule.scheduledAt).toISOString()}`;
    const fallbackDate = rule.updatedAt || rule.createdAt || now;
    return `immediate_${new Date(fallbackDate).toISOString()}`;
  }

  return toDateKey(now);
};

export const buildRuleDedupeKey = ({ rule, recipient, now = new Date() }) => {
  const period = getRulePeriodKey(rule, recipient, now);
  return [
    "rule",
    String(rule._id),
    String(recipient.recipientId),
    rule.condition,
    period,
  ].join(":");
};

const buildPromotionPayload = ({ rule, recipient }) => {
  const isCounsellor = recipient.role === "counsellor";

  return {
    title: rule.title,
    body: rule.body,
    notificationType: rule.notificationType,
    target: "selected",
    userIds: isCounsellor ? [] : [recipient.recipientId],
    audience: isCounsellor ? "selected_counsellors" : "selected_users",
    selectedUserIds: isCounsellor ? [] : [recipient.recipientId],
    selectedCounsellorIds: isCounsellor ? [recipient.recipientId] : [],
    actionUrl: rule.actionUrl || undefined,
    data: rule.data || undefined,
  };
};

const toRecipientResponse = (recipient) => ({
  recipientId: recipient.recipientId,
  fullName: recipient.fullName,
  email: recipient.email,
  role: recipient.role,
  lastActiveAt: recipient.lastActiveAt || null,
  hasFcmToken: recipient.hasFcmToken,
  inactivityAgeDays: Number.isFinite(recipient.inactivityAgeDays)
    ? Number(recipient.inactivityAgeDays.toFixed(2))
    : null,
});

const createPendingDelivery = async ({ rule, recipient, dedupeKey }) => {
  try {
    const delivery = await NotificationDelivery.create({
      ruleId: rule._id,
      recipientId: recipient.recipientId,
      title: rule.title,
      body: rule.body,
      status: "pending",
      dedupeKey,
      metadata: {
        condition: rule.condition,
        audience: rule.audience,
        notificationType: rule.notificationType,
      },
    });

    return { delivery, duplicate: false };
  } catch (error) {
    if (error?.code === 11000) {
      return { delivery: null, duplicate: true };
    }

    throw error;
  }
};

export const processNotificationRule = async (
  rule,
  { now = new Date(), dryRun = true } = {},
) => {
  const summary = {
    ruleId: String(rule?._id || ""),
    title: rule?.title || "",
    condition: rule?.condition || "",
    dryRun,
    matchedCount: 0,
    skippedReason: null,
    matchedRecipients: [],
    wouldSend: [],
    deliveryResults: [],
    error: null,
  };

  if (!rule) {
    summary.skippedReason = "missing_rule";
    return summary;
  }

  if (rule.status && rule.status !== "active") {
    summary.skippedReason = "inactive_rule";
    return summary;
  }

  if (!SUPPORTED_RULE_CONDITIONS.includes(rule.condition)) {
    summary.skippedReason = "unsupported_condition";
    return summary;
  }

  const selectedAudienceError = validateSelectedAudience(rule);
  if (selectedAudienceError) {
    summary.skippedReason = selectedAudienceError;
    return summary;
  }

  if (!isScheduledPromotionDue(rule, now)) {
    summary.skippedReason = "scheduled_not_due";
    return summary;
  }

  try {
    const matchSummary = await matchRuleRecipients(rule, now);
    summary.skippedReason = matchSummary.skippedReason;
    summary.matchedRecipients = matchSummary.matchedRecipients.map(toRecipientResponse);
    summary.matchedCount = summary.matchedRecipients.length;

    if (matchSummary.skippedReason) {
      return summary;
    }

    for (const recipient of matchSummary.matchedRecipients) {
      const dedupeKey = buildRuleDedupeKey({ rule, recipient, now });
      const payload = buildPromotionPayload({ rule, recipient });
      const resultBase = {
        recipientId: recipient.recipientId,
        status: null,
        success: false,
        skippedReason: null,
        deliveryId: null,
        mainBackendStatus: null,
        error: null,
      };

      if (dryRun) {
        summary.wouldSend.push({
          recipient: toRecipientResponse(recipient),
          payload: {
            title: payload.title,
            body: payload.body,
            notificationType: payload.notificationType,
            target: payload.target,
            audience: payload.audience,
            selectedUserCount: payload.selectedUserIds.length,
            selectedCounsellorCount: payload.selectedCounsellorIds.length,
            actionUrl: payload.actionUrl || null,
            hasData: Boolean(payload.data && Object.keys(payload.data).length > 0),
          },
          dedupeKey,
        });
        summary.deliveryResults.push({
          ...resultBase,
          status: "pending",
          success: true,
          dryRun: true,
        });
        continue;
      }

      let delivery = null;

      try {
        const createResult = await createPendingDelivery({ rule, recipient, dedupeKey });
        if (createResult.duplicate) {
          summary.deliveryResults.push({
            ...resultBase,
            status: "skipped",
            success: true,
            skippedReason: "duplicate",
          });
          continue;
        }

        delivery = createResult.delivery;

        const mainBackendResult = await sendPromotionNotificationToMainBackend(payload);
        const update = {
          status: mainBackendResult.success ? "sent" : "failed",
          mainBackendStatus: mainBackendResult.status,
          error: mainBackendResult.success ? null : mainBackendResult.error,
          sentAt: mainBackendResult.success ? new Date() : null,
        };

        await NotificationDelivery.findByIdAndUpdate(delivery._id, update);

        summary.deliveryResults.push({
          ...resultBase,
          deliveryId: String(delivery._id),
          status: update.status,
          success: mainBackendResult.success,
          mainBackendStatus: mainBackendResult.status,
          error: update.error,
        });

        if (!mainBackendResult.success && !summary.error) {
          summary.error = mainBackendResult.error || "Main Backend notification request failed";
        }
      } catch (recipientError) {
        // Isolate this recipient's failure so the remaining recipients in
        // this rule still get processed. If a "pending" delivery row was
        // already created before the failure, reconcile it to "failed"
        // instead of leaving it stuck (a stuck "pending" row would block
        // future retries forever via the unique dedupeKey index).
        const errorMessage = recipientError?.message || "Unexpected notification delivery error";

        if (delivery?._id) {
          try {
            await NotificationDelivery.findByIdAndUpdate(delivery._id, {
              status: "failed",
              error: errorMessage,
            });
          } catch (recoveryError) {
            console.error("Failed to reconcile stuck pending notification delivery:", {
              ruleId: summary.ruleId,
              recipientId: recipient.recipientId,
              deliveryId: String(delivery._id),
              error: recoveryError.message,
            });
          }
        }

        console.error("Notification delivery failed for recipient, continuing with remaining recipients:", {
          ruleId: summary.ruleId,
          recipientId: recipient.recipientId,
          error: errorMessage,
        });

        summary.deliveryResults.push({
          ...resultBase,
          deliveryId: delivery?._id ? String(delivery._id) : null,
          status: "failed",
          success: false,
          error: errorMessage,
        });

        if (!summary.error) {
          summary.error = errorMessage;
        }
      }
    }

    return summary;
  } catch (error) {
    summary.error = error.message;
    console.error("Notification rule processing failed:", {
      ruleId: summary.ruleId,
      title: summary.title,
      condition: summary.condition,
      error: error.message,
    });
    return summary;
  }
};
