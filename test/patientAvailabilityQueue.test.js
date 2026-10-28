import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import Appointment from '../src/models/appointmentModel.js';
import Walkin from '../src/models/walkinAppointmentModel.js';
import { WalkinAppointment as DisplayWalkin } from '../src/models/clinicModels.js';
import { updatePatientAvailability } from '../src/controllers/receptionistController.js';
import { todayIST } from '../src/utils/clinicAccess.js';
import { slotRepository } from '../src/services/appointmentSlotService.js';
import { clinicDisplayQueue, clinicDisplayQueueRepository } from '../src/services/clinicDisplayQueue.js';
import { findOtherActiveConsultation, getConsultationTiming } from '../src/services/consultationTimingService.js';
import { normalizeQueueAppointment, calculateEstimatedQueue } from '../src/services/queueTimingService.js';

describe('Receptionist patient availability and returned queue priority', () => {
  let res;
  const doctor = '111111111111111111111111';
  const clinic = '222222222222222222222222';
  const record = extra => ({ _id: '333333333333333333333333', counselor: doctor, doctor_id: doctor, clinic_id: clinic,
    appointment_date: todayIST(), appointment_time: '10:00', token_number: 1, status: 'pending', queue_status: 'waiting', ...extra });
  beforeEach(() => {
    res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    sinon.stub(User, 'findById').returns({ select: async () => ({ role: 'receptionist', assignedDoctor: doctor, clinic_id: clinic, isActive: true }) });
    sinon.stub(slotRepository, 'online').resolves([]);
    sinon.stub(slotRepository, 'walkins').resolves([]);
  });
  afterEach(() => sinon.restore());
  const request = (source, availability) => ({ userId: 'staff', params: { id: '333333333333333333333333' }, body: { source, availability } });
  for (const source of ['online', 'walkin']) {
    it(`reception can mark a ${source} patient absent without skipping or changing the token`, async () => {
      const Model = source === 'walkin' ? Walkin : Appointment;
      const row = record(source === 'walkin' ? { status: undefined, appointment_status: 'booked' } : {});
      const find = sinon.stub(Model, 'findOne').resolves(row);
      const update = sinon.stub(Model, 'updateOne').resolves({ matchedCount: 1 });
      await updatePatientAvailability(request(source, 'unavailable'), res);
      expect(res.status.called).to.equal(false);
      expect(find.firstCall.args[0]).to.include({ clinic_id: clinic, [source === 'walkin' ? 'doctor_id' : 'counselor']: doctor });
      const changes = update.firstCall.args[1].$set;
      expect(changes.consultation_timing.availability).to.include({ status: 'unavailable', returnedAt: null, updatedBy: 'staff' });
      expect(changes).not.to.have.any.keys('token_number', 'appointment_time', 'queue_status');
    });
    it(`returns a skipped ${source} patient to waiting with priority and preserves existing timing metadata`, async () => {
      const Model = source === 'walkin' ? Walkin : Appointment;
      const row = record({ queue_status: 'skipped', consultation_timing: { pauses: [], durationMinutes: 15 }, ...(source === 'walkin' ? { status: undefined, appointment_status: 'skipped' } : {}) });
      sinon.stub(Model, 'findOne').resolves(row);
      const update = sinon.stub(Model, 'updateOne').resolves({ matchedCount: 1 });
      await updatePatientAvailability(request(source, 'available'), res);
      expect(res.status.called).to.equal(false);
      const changes = update.firstCall.args[1].$set;
      expect(changes).to.include({ queue_status: 'waiting' });
      expect(changes.consultation_timing.durationMinutes).to.equal(15);
      expect(changes.consultation_timing.availability.status).to.equal('available');
      expect(changes.consultation_timing.availability.returnedAt).to.be.a('string');
      if (source === 'walkin') expect(changes.appointment_status).to.equal('booked');
      expect(changes).not.to.have.any.keys('token_number', 'appointment_time');
    });
  }
  it('rejects an appointment outside the assigned doctor/clinic', async () => {
    sinon.stub(Appointment, 'findOne').resolves(null);
    const update = sinon.stub(Appointment, 'updateOne');
    await updatePatientAvailability(request('online', 'unavailable'), res);
    expect(res.status.calledWith(404)).to.equal(true);
    expect(update.called).to.equal(false);
  });
  for (const extra of [{ consultation_timing: { startedAt: new Date().toISOString() } }, { status: 'completed', queue_status: 'skipped' }, { appointment_date: '2020-01-01' }]) {
    it(`rejects availability changes for an ineligible appointment ${JSON.stringify(extra)}`, async () => {
      sinon.stub(Appointment, 'findOne').resolves(record(extra));
      const update = sinon.stub(Appointment, 'updateOne');
      await updatePatientAvailability(request('online', 'available'), res);
      expect(res.status.calledWith(409)).to.equal(true);
      expect(update.called).to.equal(false);
    });
  }
  it('rejects a stale availability update after the appointment changes', async () => {
    sinon.stub(Appointment, 'findOne').resolves(record({}));
    sinon.stub(Appointment, 'updateOne').resolves({ matchedCount: 0 });
    await updatePatientAvailability(request('online', 'unavailable'), res);
    expect(res.status.calledWith(409)).to.equal(true);
  });
  it('refreshes the assigned doctor queue immediately when reception marks a patient unavailable', async () => {
    const previousIo = global.io;
    const events = [];
    global.io = { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
    try {
      sinon.stub(Appointment, 'findOne').resolves(record({}));
      sinon.stub(Appointment, 'updateOne').resolves({ matchedCount: 1 });
      await updatePatientAvailability(request('online', 'unavailable'), res);
      expect(res.status.called).to.equal(false);
      expect(events.some(item => item.room === `user_${doctor}` && item.event === 'queueUpdated' && item.payload.doctorId === doctor)).to.equal(true);
      expect(res.json.firstCall.args[0].availability).to.include({ status: 'unavailable', updatedRole: 'receptionist' });
    } finally { global.io = previousIo; }
  });
  const returnedTiming = { availability: { status: 'available', returnedAt: '2026-10-28T05:00:00Z' } };
  it('prevents starting a normal appointment ahead of a returned patient in the same clinic', async () => {
    slotRepository.walkins.resolves([record({ _id: 'returned', appointment_status: 'booked', consultation_timing: returnedTiming })]);
    try { await findOtherActiveConsultation(record({})); throw new Error('Expected conflict'); }
    catch (error) { expect(error.status).to.equal(409); expect(error.message).to.match(/Returned patient token 1/); }
  });
  it('does not interrupt a current consultation or block another clinic or an emergency', async () => {
    const returned = record({ _id: 'returned', consultation_timing: returnedTiming });
    slotRepository.online.resolves([returned]);
    expect(await findOtherActiveConsultation(record({ priority: 'emergency' }))).to.equal(null);
    expect(await findOtherActiveConsultation(record({ clinic_id: 'other' }))).to.equal(null);
    slotRepository.walkins.resolves([record({ _id: 'current', appointment_status: 'in-progress', consultation_timing: { startedAt: '2026-10-28T05:00:00Z' } })]);
    expect((await findOtherActiveConsultation(record({}))).record._id).to.equal('current');
  });
  it('prevents consultation from starting while reception reports the patient unavailable', async () => {
    try { await getConsultationTiming(record({ consultation_timing: { availability: { status: 'unavailable' } } }), { status: 'in-progress' }); throw new Error('Expected conflict'); }
    catch (error) { expect(error.status).to.equal(409); expect(error.message).to.match(/patient unavailable/); }
  });
  it('orders estimates as current, emergency, returned, regular without renumbering tokens', () => {
    const rows = [record({ _id: 'regular', token_number: 2 }), record({ _id: 'returned', appointment_time: '11:00', token_number: 3, consultation_timing: returnedTiming }),
      record({ _id: 'emergency', priority: 'emergency', token_number: 4 }), record({ _id: 'current', queue_status: 'in_progress', token_number: 1 })];
    const data = calculateEstimatedQueue(rows.map(row => normalizeQueueAppointment(row)), { doctorId: doctor, date: todayIST(), clinicId: clinic });
    expect(data.queue.map(item => item.token)).to.deep.equal([1, 4, 3, 2]);
  });
  it('keeps skipped online and walk-in tokens visible as pending and puts returned patients ahead of normal tokens', async () => {
    sinon.stub(clinicDisplayQueueRepository, 'query').resolves([[]]);
    sinon.stub(Appointment, 'find').returns({ select() { return this; }, lean: async () => [record({ _id: 'absent-online', queue_status: 'skipped', token_number: 1 }), record({ _id: 'regular', token_number: 2 }), record({ _id: 'returned', appointment_time: '11:00', token_number: 3, consultation_timing: returnedTiming })] });
    sinon.stub(DisplayWalkin, 'find').returns({ select() { return this; }, lean: async () => [record({ _id: 'absent-walkin', status: undefined, appointment_status: 'skipped', queue_status: 'booked', token_number: 4 })] });
    const queue = await clinicDisplayQueue({ id: 'link', clinic_id: clinic, doctor_id: doctor, facility_id: 'facility' }, todayIST());
    expect(queue.pending.map(row => row.tokenNumber)).to.deep.equal([1, 4]);
    expect(queue.waiting.map(row => row.tokenNumber)).to.deep.equal([3, 2]);
    expect(queue.current).to.equal(null);
  });
});
