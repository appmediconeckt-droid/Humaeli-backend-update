import Notification from "../models/Notification.js";
import User from "../models/userModel.js";
import { createNotificationSafely } from "./notificationService.js";

export const GREETING_NOTIFICATION_TIMEZONE =
  process.env.GREETING_NOTIFICATION_TIMEZONE || "Asia/Kolkata";

export const GREETING_NOTIFICATION_POLL_MS = Number(
  process.env.GREETING_NOTIFICATION_POLL_MS || 60 * 1000,
);

const GREETING_REPEAT_GAP_MINUTES = 2 * 60;

const minuteToSlot = (minute) => {
  const normalizedMinute = ((minute % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalizedMinute / 60);
  const mins = normalizedMinute % 60;
  return `${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const buildTwoHourSlots = (startMinute) => [
  minuteToSlot(startMinute),
  minuteToSlot(startMinute + GREETING_REPEAT_GAP_MINUTES),
];

const GREETING_WINDOWS = [
  {
    id: "morning",
    title: "Good Morning",
    message: "Good morning! Wishing you a calm and healthy start to your day.",
    startMinute: 5 * 60,
    endMinute: 12 * 60,
    slots: buildTwoHourSlots(5 * 60),
  },
  {
    id: "afternoon",
    title: "Good Afternoon",
    message: "Good afternoon! Take a small mindful pause for yourself.",
    startMinute: 12 * 60,
    endMinute: 17 * 60,
    slots: buildTwoHourSlots(12 * 60),
  },
  {
    id: "evening",
    title: "Good Evening",
    message: "Good evening! Hope your day is settling gently.",
    startMinute: 17 * 60,
    endMinute: 21 * 60,
    slots: buildTwoHourSlots(17 * 60),
  },
  {
    id: "night",
    title: "Good Night",
    message: "Good night! Rest well and take care of yourself.",
    startMinute: 21 * 60,
    endMinute: 24 * 60 + 5 * 60,
    slots: buildTwoHourSlots(21 * 60),
  },
];

const slotToMinute = (slot) => {
  const [hour, minute] = slot.split(":").map(Number);
  return hour * 60 + minute;
};

const getLocalParts = (date, timeZone = GREETING_NOTIFICATION_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  };
};

const getGreetingWindowForMinute = (minuteOfDay) => {
  const adjustedMinute =
    minuteOfDay < 5 * 60 ? minuteOfDay + 24 * 60 : minuteOfDay;

  return GREETING_WINDOWS.find(
    (window) =>
      adjustedMinute >= window.startMinute && adjustedMinute < window.endMinute,
  );
};

export const getDueGreetingSlot = (
  date = new Date(),
  timeZone = GREETING_NOTIFICATION_TIMEZONE,
) => {
  const { dateKey, minuteOfDay } = getLocalParts(date, timeZone);
  const window = getGreetingWindowForMinute(minuteOfDay);
  if (!window) return null;

  const slot = window.slots.find((slotTime) => {
    const slotMinute = slotToMinute(slotTime);
    return minuteOfDay === slotMinute;
  });

  if (!slot) return null;

  return {
    ...window,
    slot,
    dateKey,
    key: `${dateKey}:${window.id}:${slot}`,
  };
};

export const sendDueGreetingNotifications = async (
  date = new Date(),
  {
    timeZone = GREETING_NOTIFICATION_TIMEZONE,
    logger = console,
  } = {},
) => {
  const dueSlot = getDueGreetingSlot(date, timeZone);
  if (!dueSlot) return { sent: 0, skipped: 0, due: null };

  const recipients = await User.find({
    role: { $in: ["user", "counsellor"] },
    isActive: true,
    fcmToken: { $type: "string", $ne: "" },
  })
    .select("_id role")
    .lean();

  let sent = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const alreadySent = await Notification.exists({
      recipientId: recipient._id,
      type: "system",
      "data.greetingKey": dueSlot.key,
    });

    if (alreadySent) {
      skipped += 1;
      continue;
    }

    const notification = await createNotificationSafely({
      recipientId: recipient._id,
      type: "system",
      title: dueSlot.title,
      message: dueSlot.message,
      data: {
        type: "GREETING",
        greetingPeriod: dueSlot.id,
        greetingSlot: dueSlot.slot,
        greetingDate: dueSlot.dateKey,
        greetingKey: dueSlot.key,
        recipientRole: recipient.role,
      },
    });

    if (notification) sent += 1;
  }

  if (sent || skipped) {
    logger.info?.(
      `Greeting notification ${dueSlot.key}: sent=${sent}, skipped=${skipped}`,
    );
  }

  return { sent, skipped, due: dueSlot };
};

export const startGreetingNotificationJob = ({
  intervalMs = GREETING_NOTIFICATION_POLL_MS,
  timeZone = GREETING_NOTIFICATION_TIMEZONE,
  logger = console,
} = {}) => {
  if (process.env.GREETING_NOTIFICATIONS_ENABLED === "false") {
    logger.info?.("Greeting notifications disabled");
    return null;
  }

  let isRunning = false;
  const run = async () => {
    if (isRunning) return;

    isRunning = true;
    try {
      await sendDueGreetingNotifications(new Date(), { timeZone, logger });
    } catch (error) {
      logger.error?.("Greeting notification job failed:", error.message);
    } finally {
      isRunning = false;
    }
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
};
