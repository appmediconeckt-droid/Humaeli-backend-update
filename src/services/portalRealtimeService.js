// Invalidate only affected accounts. Never include medical or financial records
// in the event: each screen reloads through its existing authorized endpoint.
export const emitResourceUpdated = (resource, recipients = []) => {
  if (!global.io) return;
  const ids = [...new Set(recipients.map((value) => {
    if (!value) return null;
    if (typeof value.toHexString === 'function') return value.toHexString();
    return value._id || value.id || value;
  }).filter(Boolean).map(String))];
  const payload = { resource, updatedAt: new Date().toISOString() };
  for (const id of ids) global.io.to(`user_${id}`).emit(`${resource}:updated`, payload);
};

export const emitAppointmentUpdated = (appointment) => {
  emitResourceUpdated('appointments', [
    appointment?.patient, appointment?.patient_id,
    appointment?.counselor, appointment?.doctor_id,
  ]);
  emitAvailabilityUpdated(appointment?.counselor || appointment?.doctor_id);
};

// Slot occupancy and working hours are public; patient identifiers are omitted.
export const emitAvailabilityUpdated = (doctor) => {
  const doctorId = typeof doctor?.toHexString === "function" ? doctor.toHexString() : doctor?._id || doctor?.id || doctor;
  if (doctorId) global.io?.emit?.('availability:updated', { doctorId: String(doctorId) });
};

export const emitPrescriptionUpdated = (prescription) => {
  emitResourceUpdated('prescriptions', [prescription?.patientId, prescription?.psychiatristId]);
};

export const emitChatUpdated = (chat) => {
  emitResourceUpdated('chats', [chat?.userId, chat?.counselorId]);
};
