import { emitAppointmentUpdated } from '../services/portalRealtimeService.js';
import { withRatingLock, summarizeAppointmentRatings } from '../services/doctorRatingService.js';
import mongoose from '../persistence/mongoose.js';
import { Clinic } from '../models/clinicModels.js';
import Appointment from '../models/appointmentModel.js';

export async function submitDoctorRating(req, res) {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Only patients can rate their doctor.' });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid appointment.' });
  const { rating, review = '' } = req.body;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || typeof review !== 'string' || review.trim().length > 500) {
    return res.status(400).json({ error: 'Choose 1–5 stars and a review of up to 500 characters.' });
  }
  try {
    const appointment = await Appointment.findOne({ _id: req.params.id, patient: req.user._id })
      .populate('counselor', 'role accountType').lean();
    if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });
    if (appointment.status !== 'completed') return res.status(400).json({ error: 'You can rate the doctor after your appointment is completed.' });
    if (appointment.counselor?.role !== 'doctor' && appointment.counselor?.accountType !== 'doctor') {
      return res.status(400).json({ error: 'This appointment is not with a doctor.' });
    }
    return await withRatingLock('doctor', appointment.counselor?._id || appointment.counselor, async () => {
      const previous = await Appointment.exists({ patient: req.user._id, counselor: appointment.counselor?._id || appointment.counselor, doctorRating: { $exists: true } });
      if (previous) return res.status(409).json({ error: 'You have already rated this doctor.' });
      const doctorRating = { stars: rating, review: review.trim(), submittedAt: new Date() };
      // Retain the appointment-level conditional update as an additional guard.
      const saved = await Appointment.findOneAndUpdate({
        _id: appointment._id, patient: req.user._id, status: 'completed',
        doctorRating: { $exists: false },
      }, { $set: { doctorRating } }, { new: true, runValidators: true });
      if (!saved) return res.status(409).json({ error: 'This appointment has already been rated.' });
      emitAppointmentUpdated({ patient: req.user._id, counselor: appointment.counselor });
      global.io?.emit?.('counselor-directory-updated', {});
      return res.status(201).json({ doctorRating: saved.doctorRating });
    });
  } catch (error) {
    console.error('Doctor rating failed:', error.message);
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'Rating could not be saved. Please try again.' });
  }
}

export async function submitClinicRating(req, res) {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Only patients can rate their clinic.' });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid appointment.' });
  const { rating, review = '' } = req.body;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || typeof review !== 'string' || review.trim().length > 500) {
    return res.status(400).json({ error: 'Choose 1–5 stars and a review of up to 500 characters.' });
  }
  try {
    const appointment = await Appointment.findOne({ _id: req.params.id, patient: req.user._id })
      .populate('counselor', 'role accountType').lean();
    if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });
    if (appointment.status !== 'completed') return res.status(400).json({ error: 'You can rate the clinic after your appointment is completed.' });
    if (!appointment.clinic_id || !await Clinic.exists({ _id: appointment.clinic_id })) return res.status(400).json({ error: 'Clinic not found for this appointment.' });
    return await withRatingLock('clinic', appointment.clinic_id?._id || appointment.clinic_id, async () => {
      const previous = await Appointment.exists({ patient: req.user._id, clinic_id: appointment.clinic_id?._id || appointment.clinic_id, clinicRating: { $exists: true } });
      if (previous) return res.status(409).json({ error: 'You have already rated this clinic.' });
      const clinicRating = { stars: rating, review: review.trim(), submittedAt: new Date() };
      // Retain the appointment-level conditional update as an additional guard.
      const saved = await Appointment.findOneAndUpdate({
        _id: appointment._id, patient: req.user._id, status: 'completed',
        clinicRating: { $exists: false },
      }, { $set: { clinicRating } }, { new: true, runValidators: true });
      if (!saved) return res.status(409).json({ error: 'This appointment has already been rated.' });
      emitAppointmentUpdated({ patient: req.user._id, counselor: appointment.counselor });
      global.io?.emit?.('counselor-directory-updated', {});
      return res.status(201).json({ clinicRating: saved.clinicRating });
    });
  } catch (error) {
    console.error('Doctor rating failed:', error.message);
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'Rating could not be saved. Please try again.' });
  }
}

export async function getDoctorRatingSummary(req, res) {
  try {
    const doctorId = req.user._id || req.userId;
    // Reviewer names are available only through this authenticated doctor route.
    // Scope by the signed-in doctor, never a doctor ID supplied by the client.
    const rows = await Appointment.find({ counselor: doctorId, $or: [
      { doctorRating: { $exists: true } }, { clinicRating: { $exists: true } },
    ] }).select('counselor clinic_id patient doctorRating clinicRating')
      .populate('patient', 'fullName anonymous').lean();
    const summary = summarizeAppointmentRatings(rows, 'doctor', { includeReviewer: true }).get(String(doctorId));
    const clinics = summarizeAppointmentRatings(rows, 'clinic', { includeReviewer: true });
    const ownedClinics = await Clinic.find({ doctor_id: doctorId }).select('_id clinic_name').lean();
    const newest = reviews => [...reviews].sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
    return res.json({ rating: summary?.rating || 0, ratingCount: summary?.ratingCount || 0,
      distribution: summary?.distribution || {}, reviews: newest(summary?.reviews || []),
      clinics: ownedClinics.map(clinic => {
        const value = clinics.get(String(clinic._id));
        return { clinicId: String(clinic._id), name: clinic.clinic_name, rating: value?.rating || 0,
          ratingCount: value?.ratingCount || 0, distribution: value?.distribution || {}, reviews: newest(value?.reviews || []) };
      }) });
  } catch (error) {
    return res.status(500).json({ error: 'Ratings could not be loaded. Please try again.' });
  }
}
