import { expect } from 'chai';
import { doctorVitalsAppointment } from '../../chatbot-frontend/src/Component/DoctorDashboard/doctorVitalsAppointment.js';

describe('Doctor vitals appointment mapping', () => {
  it('uses the real API ID and walk-in source from a dashboard row', () => {
    const patient = doctorVitalsAppointment({ id: 'walkin-123', apiId: '123', appointmentSource: 'walkin', appointmentDate: '2026-10-24', name: 'Patient', status: 'confirmed', queueStatus: 'waiting' });
    expect(patient).to.include({ id: '123', source: 'walkin', date: '2026-10-24', patientName: 'Patient', status: 'confirmed', queueStatus: 'waiting' });
  });
  it('preserves original status and timing from appointment list rows', () => {
    const patient = doctorVitalsAppointment({ id: 'online:123', apiId: '123', apiSource: 'online', status: 'Pending', date: 'Oct 24, 2026', vitalsAppointment: {
      _id: '123', appointment_date: '2026-10-24', status: 'confirmed', queue_status: 'completed', consultation_timing: { endedAt: '2026-10-24T10:00:00Z' },
    } });
    expect(patient).to.include({ id: '123', source: 'online', date: '2026-10-24', status: 'confirmed', queueStatus: 'completed' });
    expect(patient.consultation_timing.endedAt).to.equal('2026-10-24T10:00:00Z');
  });
  it('uses visit record source and the latest saved vitals in patient details', () => {
    const vitals = { pulse: 76 };
    const patient = doctorVitalsAppointment({ id: '123', date: '24 Oct 2026', vitals, prescriptionRecord: { _id: '123', appointment_type: 'walkin', appointment_date: '2026-10-24', appointment_status: 'booked', vitals: { pulse: 70 } } });
    expect(patient).to.include({ id: '123', source: 'walkin', date: '2026-10-24', status: 'booked' });
    expect(patient.vitals).to.deep.equal(vitals);
  });
});
