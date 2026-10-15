import Appointment from '../models/appointmentModel.js';
import WalkinAppointment from '../models/walkinAppointmentModel.js';
import { actorId, fail, handle } from '../utils/clinicAccess.js';
import { latestPatientVitals } from '../services/patientVitalsService.js';

export const getMyVitals = handle(async (req, res) => {
  const patientId = actorId(req);
  if (!patientId) throw fail(401, 'Authentication required');
  // Only explicit account links grant access, including visits with other doctors.
  const [online, walkins] = await Promise.all([
    Appointment.find({ patient: patientId }).select('vitals appointment_date checked_in_at').lean(),
    WalkinAppointment.find({ patient_id: patientId }).lean(),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, latest: latestPatientVitals(online, walkins) });
});
