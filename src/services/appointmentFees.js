// All amounts here are major currency units; payment orders convert to paise.
export function appointmentAdditionalFee(mode, clinic, provider) {
  if (mode === 'video') {
    const doctor = [provider?.role, provider?.accountType].some(value => String(value || '').toLowerCase() === 'doctor');
    return doctor ? Number(clinic?.videoConsultationAdditionalFee ?? 0) : 10;
  }
  return mode === 'voice' ? 5 : 0;
}
