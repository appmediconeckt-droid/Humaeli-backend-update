import mongoose from '../persistence/mongoose.js';
import Appointment from '../models/appointmentModel.js';
import { createNotificationSafely } from '../services/notificationService.js';

export const patientEmergencyDependencies = { notify: createNotificationSafely };

export async function requestPatientEmergency(req, res) {
  if (req.user.role !== 'user') return res.status(403).json({ success: false, message: 'Only patients can send this request.' });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid appointment.' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (req.body.is_emergency === false || reason.length < 10 || reason.length > 1000) {
    return res.status(400).json({ success: false, message: 'Describe the emergency in 10 to 1000 characters.' });
  }
  try {
    const row = await Appointment.findOne({ _id: req.params.id, patient: req.user._id })
      .populate('counselor', 'role accountType').lean();
    if (!row) return res.status(404).json({ success: false, message: 'Appointment not found.' });
    if (!['pending', 'confirmed', 'accepted', 'booked', 'in-progress'].includes(row.status)
      || ['completed', 'canceled', 'cancelled', 'no_show', 'skipped'].includes(row.queue_status)) {
      return res.status(400).json({ success: false, message: 'Emergency requests are only available for active appointments.' });
    }
    if (row.counselor?.role !== 'doctor' && row.counselor?.accountType !== 'doctor') {
      return res.status(400).json({ success: false, message: 'Emergency requests are available for doctor appointments.' });
    }
    if (row.priority === 'emergency') return res.json({ success: true, message: 'Emergency request already sent.' });
    const updated = await Appointment.findOneAndUpdate({
      _id: row._id, patient: req.user._id, status: row.status, queue_status: row.queue_status,
      priority: { $ne: 'emergency' },
    }, { $set: { priority: 'emergency', emergency_reason: reason } }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ success: false, message: 'Appointment changed. Refresh your appointments and try again.' });
    const doctorId = String(row.counselor._id);
    const notice = await patientEmergencyDependencies.notify({
      recipientId: doctorId, actorId: req.user._id, type: 'appointment',
      title: 'Patient emergency alert', message: 'A booked patient reports worsening health. Please review their emergency request.',
      data: { type: 'EMERGENCY_APPOINTMENT', appointmentId: String(row._id), patientId: String(req.user._id),
        doctorId, clinicId: String(row.clinic_id || ''), priority: 'emergency' },
      actionUrl: '/appointmentlist',
    });
    if (global.io) {
      for (const room of [`user_${doctorId}`, `doctor_queue_${doctorId}`, `counsellor_${doctorId}`, `counselor_${doctorId}`, `user_${req.user._id}`]) {
        global.io.to(room).emit('queueUpdated', { doctorId, appointmentDate: row.appointment_date, appointmentId: String(row._id) });
      }
    }
    return res.json({ success: true, message: notice
      ? 'Emergency request sent. The doctor has been notified.'
      : 'Emergency priority saved. The alert could not be created; please contact the clinic.', notificationCreated: Boolean(notice) });
  } catch (error) {
    console.error('Patient emergency request failed:', error.message);
    return res.status(500).json({ success: false, message: 'Emergency request could not be sent. Please try again.' });
  }
}
