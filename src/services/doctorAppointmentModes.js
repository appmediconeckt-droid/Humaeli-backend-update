import { fail } from '../utils/clinicAccess.js';

export function validateDoctorAppointmentMode(provider, mode) {
  const doctor = [provider?.role, provider?.accountType].some(value => String(value || '').toLowerCase() === 'doctor');
  if (!doctor || mode === undefined) return;
  if (!['in-clinic', 'video'].includes(mode)) {
    throw fail(400, 'Doctor appointments support only General Checkup or Video Consultation.');
  }
}
