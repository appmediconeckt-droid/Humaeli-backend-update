import express from 'express';
import rateLimit from 'express-rate-limit';
import { clinicDisplayQueue } from '../services/clinicDisplayQueue.js';
import { queueToday } from '../utils/queueDate.js';
import { protect } from '../middleware/authMiddleware.js';
import { doctorScope, handle, fail } from '../utils/clinicAccess.js';
import { query } from '../config/mysql.js';
import { profileQr, publicDoctor, doctorClinics, resolveWalkin, publicWalkin, bookClinicWalkin } from '../services/clinicQrService.js';
const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/doctors/:doctorId/profile', handle(async (req, res) => res.json({ success: true, data: await publicDoctor(req.params.doctorId) })));
router.get('/doctors/:doctorId/clinics', protect, handle(async (req, res) => {
  await doctorScope(req, req.params.doctorId);
  const clinics = await doctorClinics(req.params.doctorId, true);
  res.json({ success: true, data: { clinics: clinics.map(clinic => ({ ...clinic,
    ledPath: `/display/clinic/${clinic.doctorClinicId}` })) } });
}));
router.get('/walkin/:doctorClinicId/queue', handle(async (req, res) => {
  const { link, doctor, clinic } = await resolveWalkin(req.params.doctorClinicId);
  const queueDate = queueToday();
  const data = await clinicDisplayQueue(link, queueDate);
  res.json({ success: true, displayType: 'doctor', displayName: 'Clinic queue',
    doctorClinicId: link.id, facility: { id: link.facility_id, name: clinic?.clinic_name || link.facility_name },
    doctor: { id: link.doctor_id, name: doctor.fullName }, roomId: link.roomId || null, queueDate,
    current: data.current ? { token: data.current.tokenNumber, status: data.current.status } : null,
    nextTokens: data.waiting.slice(0, 4).map(entry => entry.tokenNumber),
    waitingCount: data.waitingCount, totalPatients: data.totalPatients, completedCount: data.completedCount });
}));
router.patch('/walkin/:doctorClinicId/room', protect, handle(async (req, res) => {
  const { link } = await resolveWalkin(req.params.doctorClinicId);
  await doctorScope(req, link.doctor_id);
  const room = req.body?.roomNumber;
  if (typeof room !== 'string' || !room.trim() || room.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(room)) {
    throw fail(400, 'Enter a room number between 1 and 100 characters');
  }
  await query('UPDATE doctor_facilities SET roomId=? WHERE id=? AND doctorId=? AND facilityId=?',
    [room.trim(), link.mapping_id, link.doctor_id, link.facility_id]);
  res.json({ success: true, data: { doctorClinicId: link.id, roomNumber: room.trim() } });
}));
router.get('/doctors/:doctorId/codes', protect, handle(async (req, res) => {
  await doctorScope(req, req.params.doctorId);
  res.json({ success: true, data: { ...await profileQr(req.params.doctorId), clinics: await doctorClinics(req.params.doctorId, true) } });
}));
router.get('/walkin/:doctorClinicId', handle(async (req, res) => res.json({ success: true, data: publicWalkin(await resolveWalkin(req.params.doctorClinicId)) })));
router.post('/walkin/:doctorClinicId', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }), handle(async (req, res) => {
  res.status(201).json({ success: true, data: await bookClinicWalkin(req.params.doctorClinicId, req.body || {}) });
}));
export default router;
