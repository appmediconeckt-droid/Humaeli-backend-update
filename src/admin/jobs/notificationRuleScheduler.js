import NotificationRule from "../models/NotificationRule.js";
import { processNotificationRule } from "../services/notificationRuleProcessor.js";
import { SUPPORTED_RULE_CONDITIONS } from "../services/notificationRecipientMatcher.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

let schedulerTimer = null;
let isProcessing = false;

const isSchedulerEnabled = () =>
  String(process.env.NOTIFICATION_RULE_SCHEDULER_ENABLED || "false").toLowerCase() ===
  "true";

const isDryRunEnabled = () =>
  String(process.env.NOTIFICATION_RULE_SCHEDULER_DRY_RUN || "true").toLowerCase() ===
  "true";

const getSchedulerIntervalMs = () => {
  const configured = Number.parseInt(
    process.env.NOTIFICATION_RULE_SCHEDULER_INTERVAL_MS,
    10,
  );

  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_INTERVAL_MS;
};

const buildDueRuleQuery = (now) => ({
  status: "active",
  condition: { $in: SUPPORTED_RULE_CONDITIONS },
  $or: [
    { condition: { $in: ["inactive_2_days", "inactive_5_7_days", "counsellor_inactive"] } },
    {
      condition: "scheduled_promotion",
      sendImmediately: true,
      $or: [
        { lastProcessedAt: null },
        { lastProcessedAt: { $exists: false } },
      ],
    },
    {
      condition: "scheduled_promotion",
      scheduledAt: { $ne: null, $lte: now },
      $or: [
        { lastProcessedAt: null },
        { lastProcessedAt: { $exists: false } },
        { $expr: { $lt: ["$lastProcessedAt", "$scheduledAt"] } },
      ],
    },
  ],
});

export const processDueNotificationRules = async ({
  now = new Date(),
  dryRun = isDryRunEnabled(),
} = {}) => {
  const summary = {
    dryRun,
    ruleCount: 0,
    matchedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    rules: [],
  };

  if (isProcessing) {
    summary.skippedCount += 1;
    summary.rules.push({ skippedReason: "overlapping_run" });
    return summary;
  }

  isProcessing = true;

  try {
    const rules = await NotificationRule.find(buildDueRuleQuery(now))
      .sort({ scheduledAt: 1, createdAt: -1 })
      .lean();

    summary.ruleCount = rules.length;

    for (const rule of rules) {
      const ruleSummary = await processNotificationRule(rule, { now, dryRun });
      summary.rules.push(ruleSummary);
      summary.matchedCount += ruleSummary.matchedCount;

      if (ruleSummary.error) {
        summary.failedCount += 1;
      } else if (ruleSummary.skippedReason) {
        summary.skippedCount += 1;
      }

      if (
        !dryRun &&
        rule.condition === "scheduled_promotion" &&
        !ruleSummary.error &&
        !ruleSummary.skippedReason
      ) {
        await NotificationRule.findByIdAndUpdate(rule._id, {
          lastProcessedAt: now,
          sendImmediately: false,
        });
      }
    }

    console.log("Notification rule scheduler finished:", {
      ruleCount: summary.ruleCount,
      matchedCount: summary.matchedCount,
      skippedCount: summary.skippedCount,
      failedCount: summary.failedCount,
      dryRun,
    });

    return summary;
  } catch (error) {
    summary.failedCount += 1;
    console.error("Notification rule scheduler could not process rules:", {
      error: error.message,
    });
    return summary;
  } finally {
    isProcessing = false;
  }
};

export const startNotificationRuleScheduler = () => {
  if (!isSchedulerEnabled()) {
    console.log("Notification rule scheduler disabled.");
    return null;
  }

  if (schedulerTimer) return schedulerTimer;

  const intervalMs = getSchedulerIntervalMs();

  schedulerTimer = setInterval(() => {
    processDueNotificationRules().catch((error) => {
      console.error("Notification rule scheduler run failed:", {
        error: error.message,
      });
    });
  }, intervalMs);

  processDueNotificationRules().catch((error) => {
    console.error("Notification rule scheduler initial run failed:", {
      error: error.message,
    });
  });

  console.log("Notification rule scheduler started:", {
    intervalMs,
    dryRun: isDryRunEnabled(),
  });

  return schedulerTimer;
};

export const stopNotificationRuleScheduler = () => {
  if (!schedulerTimer) return false;

  clearInterval(schedulerTimer);
  schedulerTimer = null;
  return true;
};
