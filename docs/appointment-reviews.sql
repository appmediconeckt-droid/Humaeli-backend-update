-- Doctor and clinic feedback is stored in appointments.doctorRating and
-- appointments.clinicRating (JSON), not in ratings or a generic comment column.
-- This read-only query displays the values as separate columns.
SELECT
  id AS appointment_id,
  counselor AS doctor_id,
  clinic_id,
  JSON_UNQUOTE(JSON_EXTRACT(doctorRating, '$.stars')) AS doctor_stars,
  JSON_UNQUOTE(JSON_EXTRACT(doctorRating, '$.review')) AS doctor_comment,
  JSON_UNQUOTE(JSON_EXTRACT(clinicRating, '$.stars')) AS clinic_stars,
  JSON_UNQUOTE(JSON_EXTRACT(clinicRating, '$.review')) AS clinic_comment
FROM appointments
WHERE doctorRating IS NOT NULL OR clinicRating IS NOT NULL;

-- To remove a review, identify the exact appointment_id and the review type.
-- Use Appointment.updateOne({ _id: appointmentId }, { $unset: { doctorRating: 1 } })
-- (or clinicRating) through the application's model. This preserves the visit
-- and other review, and updates the MySQL row metadata consistently.
