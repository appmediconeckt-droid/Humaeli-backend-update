export const appointmentPatientPhone = row => [
  row.patient?.phoneNumber, row.patient?.phone_number, row.patient?.phone,
  row.patient?.mobile, row.phone_number, row.phoneNumber, row.patient_phone, row.phone,
].find(value => value != null && String(value).trim() !== '')?.toString().trim() || '';
