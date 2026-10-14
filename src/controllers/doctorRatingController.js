import mongoose from '../persistence/mongoose.js';
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
    const doctorRating = { stars: rating, review: review.trim(), submittedAt: new Date() };
    // Conditional update prevents two requests from rating the same appointment.
    const saved = await Appointment.findOneAndUpdate({
      _id: appointment._id, patient: req.user._id, status: 'completed',
      doctorRating: { $exists: false },
    }, { $set: { doctorRating } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'This appointment has already been rated.' });
    return res.status(201).json({ doctorRating: saved.doctorRating });
  } catch (error) {
    console.error('Doctor rating failed:', error.message);
    return res.status(500).json({ error: 'Rating could not be saved. Please try again.' });
  }
}
