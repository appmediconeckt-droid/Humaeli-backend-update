import Appointment from "../models/appointmentModel.js";
import WalkinAppointment from "../models/walkinAppointmentModel.js";
import User from "../models/userModel.js";
import { DoctorBreak } from "../models/clinicModels.js";
import { indiaDateTime, slotRepository } from "../services/appointmentSlotService.js";
import { calculateEstimatedQueue, normalizeQueueAppointment, isActiveQueueAppointment, isServingQueueAppointment, queueRecordKey } from "../services/queueTimingService.js";

export const tokenTimingRepository = {
  breaks: async (doctorId, date) => {
    try {
      const start = new Date(`${date}T00:00:00+05:30`);
      return await DoctorBreak.find({ doctor_id: doctorId, started_at: {
        $gte: start,
        $lt: new Date(start.getTime() + 86400000),
      } }).lean();
    } catch (error) {
      console.warn("Token status break lookup failed:", error.message);
      return [];
    }
  },
};

const optionalTokenLookup = async (label, lookup, fallback = []) => {
  try {
    return await lookup();
  } catch (error) {
    console.warn(`Token status ${label} lookup failed:`, error.message);
    return fallback;
  }
};
const recordId = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || value.userId || "");
  return String(value);
};
const asArray = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const normalize = normalizeQueueAppointment;
const isActive = isActiveQueueAppointment;

export const formatTokenStatus = (own, records, doctor, ranges = [], breaks = [], now = Date.now()) => {
  const state = calculateEstimatedQueue(asArray(records).some((item) => queueRecordKey(item) === queueRecordKey(own))
    ? asArray(records) : [own, ...asArray(records)], {
    doctorId: own.doctorId, date: own.date, clinicId: own.clinicId,
    ranges: asArray(ranges), breaks: asArray(breaks), now,
  });
  const { queue, current, doctorStatus } = state;
  const position = queue.findIndex((item) => queueRecordKey(item) === queueRecordKey(own));
  const ahead = position < 0 ? [] : queue.slice(0, position);
  const timing = state.estimates.get(queueRecordKey(own)) || {};
  const estimatedTurnTime = timing.estimatedStartAt || null;
  const isYourTurn = Boolean(current && queueRecordKey(current) === queueRecordKey(own));
  const emergencies = queue.filter((item) => item.emergency && !isServingQueueAppointment(item));
  const wait = timing.waitingMinutes ?? null;
  const notice = timing.estimateUncertain
    ? 'Your number may be called anytime. Please stay near the clinic.'
    : estimatedTurnTime && !isYourTurn && wait <= 30
      ? 'Your number may come within 30 minutes. Please stay near the clinic.' : null;
  return {
    appointment: {
      appointmentId: `${own.source}:${own.id}`, _id: own.id, source: own.source,
      appointmentDate: own.date, appointmentTime: own.time, status: own.status,
      createdAt: own.createdAt, bookedAt: own.createdAt, scheduledStartAt: timing.scheduledStartAt || null,
      doctor: { _id: own.doctorId, fullName: doctor?.fullName || 'Doctor' },
      estimatedAppointmentTime: estimatedTurnTime ? indiaDateTime(estimatedTurnTime).time : null,
      estimatedStartAt: estimatedTurnTime, estimatedEndAt: timing.estimatedEndAt || null,
      actualStartAt: timing.actualStartAt || null, actualEndAt: timing.actualEndAt || null,
      expectedDurationMinutes: timing.expectedDurationMinutes,
      delayMinutes: Math.max(0, timing.timingDifferenceMinutes || 0),
      timingRelation: timing.timingRelation ?? null, timingDifferenceMinutes: timing.timingDifferenceMinutes ?? null,
      timingLabel: timing.timingLabel || null,
    },
    token: { myToken: own.token, queueStatus: own.queueStatus },
    current: {
      currentToken: current?.token ?? null, doctorStatus,
      consultationStartedAt: current?.timing?.startedAt || null,
      elapsedSeconds: state.elapsedSeconds, durationMinutes: state.durationMinutes,
      isYourTurn, serverTime: new Date(now).toISOString(),
    },
    queue: {
      totalWaiting: queue.filter((item) => !isServingQueueAppointment(item)).length,
      patientsAhead: position < 0 ? null : ahead.length, queuePosition: position < 0 ? null : position + 1,
      estimatedWaitMinutes: wait, estimatedTurnTime,
      timingRelation: timing.timingRelation ?? null, timingDifferenceMinutes: timing.timingDifferenceMinutes ?? null,
      timingLabel: timing.timingLabel || null, estimateUncertain: Boolean(timing.estimateUncertain),
      notifyWithinMinutes: Boolean(estimatedTurnTime && !isYourTurn && wait <= 30), notice,
    },
    emergency: { active: emergencies.length > 0, totalEmergencyPatients: emergencies.length,
      emergencyPatientsAhead: ahead.filter((item) => item.emergency).length },
  };
};

export const getMyTokenStatus = async (req, res) => {
  try {
    const userId = recordId(req.user?._id || req.user?.id || req.userId || req.user?.userId);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const byPatient = await optionalTokenLookup("online appointment", () => Appointment.find({ patient: userId }), []);
    const byPatientId = Array.isArray(byPatient) && byPatient.length > 0
      ? []
      : await optionalTokenLookup("online appointment patient_id", () => Appointment.find({ patient_id: userId }), []);
    const online = asArray(byPatient).length > 0 ? asArray(byPatient) : asArray(byPatientId);
    const [walkins] = await Promise.all([
      optionalTokenLookup("walk-in appointment", () => WalkinAppointment.find({ patient_id: userId })),
    ]);
    const mine = [...online.map((record) => normalize(record, "online")), ...asArray(walkins).map((record) => normalize(record, "walkin"))]
      .filter(isActive)
      .sort((a, b) => {
        const timestamp = (item) => Date.parse(item.createdAt || `${item.date}T${item.time || "00:00:00"}+05:30`) || 0;
        return timestamp(b) - timestamp(a) || b.id.localeCompare(a.id);
      });
    const queues = new Map();
    const doctors = new Map();
    const schedules = new Map();
    const doctorBreaks = new Map();
    const snapshotTime = Date.now();
    const appointments = (await Promise.all(mine.map(async (own) => {
      try {
        if (!doctors.has(own.doctorId)) {
          doctors.set(own.doctorId, optionalTokenLookup("doctor", () => User.findById(own.doctorId).select("fullName").lean(), null));
        }
        if (!isActive(own)) return formatTokenStatus(own, [], await doctors.get(own.doctorId));
        const key = `${own.doctorId}:${own.date}`;
        if (!queues.has(key)) queues.set(key, Promise.all([
          optionalTokenLookup("online queue", () => slotRepository.online(own.doctorId, own.date)),
          optionalTokenLookup("walk-in queue", () => slotRepository.walkins(own.doctorId, own.date)),
        ]).then(([booked, walkin]) => {
          const queue = [...asArray(booked).map((record) => normalize(record, "online")), ...asArray(walkin).map((record) => normalize(record, "walkin"))];
          return queue.some((item) => item.id === own.id && item.source === own.source) ? queue : [own, ...queue];
        }));
        if (!schedules.has(own.doctorId)) schedules.set(own.doctorId, optionalTokenLookup("schedule", () => slotRepository.ranges(own.doctorId)));
        if (!doctorBreaks.has(key)) doctorBreaks.set(key, tokenTimingRepository.breaks(own.doctorId, own.date));
        const [queue, doctor, ranges, breaks] = await Promise.all([queues.get(key), doctors.get(own.doctorId), schedules.get(own.doctorId), doctorBreaks.get(key)]);
        return formatTokenStatus(own, queue, doctor, ranges, breaks, snapshotTime);
      } catch (error) {
        console.error(`Failed to format token status for ${own.source}:${own.id}:`, error.stack || error.message);
        return null;
      }
    }))).filter(Boolean);
    res.set("Cache-Control", "private, no-store");
    return res.json({ success: true, appointments });
  } catch (error) {
    console.error("Failed to load token status:", error.stack || error.message);
    return res.status(500).json({ success: false, message: "Unable to load token status" });
  }
};
