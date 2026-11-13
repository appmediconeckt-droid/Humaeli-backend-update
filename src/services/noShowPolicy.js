const DAY = 24 * 60 * 60 * 1000;
const timestamp = value => value == null || value === '' ? NaN : new Date(value).getTime();

// Original scheduled time, or booking time for an unscheduled emergency.
export const getNoShowCancellationDeadline = appointment => {
  let start;
  if (appointment.priority === 'emergency' && !appointment.appointment_time) {
    start = timestamp(appointment.createdAt || appointment.created_at || appointment.date);
  } else if (appointment.appointment_date && appointment.appointment_time) {
    start = timestamp(`${String(appointment.appointment_date).slice(0, 10)}T${appointment.appointment_time}+05:30`);
  } else start = timestamp(appointment.date);
  return Number.isFinite(start) ? new Date(start + DAY) : null;
};
