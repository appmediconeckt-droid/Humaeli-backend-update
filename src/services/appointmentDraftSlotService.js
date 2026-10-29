import Appointment from '../models/appointmentModel.js';
import AppointmentPayment from '../models/appointmentPaymentModel.js';
import { withAppointmentSlot } from './appointmentSlotService.js';
import { fail } from '../utils/clinicAccess.js';

// Reacquire a released slot under the same doctor/day lock used by cash and
// walk-in bookings. A late gateway success must never double-book that time.
export async function reclaimReleasedPaymentSlot(record) {
  if (!record.slotReleased) return;
  const draft = await Appointment.findOne({ _id: record.appointmentId, patient: record.userId, status: 'awaiting_payment' }, null, { includePaymentDrafts: true });
  if (!draft) throw fail(409, 'This payment draft is no longer available.');
  const claim = async () => {
    await Appointment.updateOne({ _id: draft._id, status: 'awaiting_payment' }, {
      $set: { queue_status: 'awaiting_payment', slot_key: `${draft.counselor}:${new Date(draft.date).toISOString()}` },
    });
    if (record._id) await AppointmentPayment.updateOne({ _id: record._id }, { $set: { slotReleased: false } });
  };
  if (draft.clinic_id) {
    await withAppointmentSlot({ doctorId: draft.counselor, patientId: draft.patient, date: draft.appointment_date,
      time: draft.appointment_time, clinicId: draft.clinic_id }, claim);
  } else await claim();
}
