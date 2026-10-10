import { expect } from 'chai';
import sinon from 'sinon';
import { slotRepository } from '../src/services/appointmentSlotService.js';
import { notifyUpcomingQueuePatients } from '../src/services/consultationTimingService.js';
import { notifyNextQueueTokens, queueTurnNotificationDelivery } from '../src/services/queueTurnNotificationService.js';
import { notifyClinicDisplayPatients, clinicDisplayQueue, clinicDisplayQueueRepository } from '../src/services/clinicDisplayQueue.js';
import Appointment from '../src/models/appointmentModel.js';
import { WalkinAppointment } from '../src/models/clinicModels.js';

const date = '2026-10-09';
const record = (id, token, extra = {}) => ({ _id: id, counselor: 'doctor-1', patient: `patient-${id}`,
  clinic_id: 'clinic-1', appointment_date: date, appointment_time: `10:${String(token * 5).padStart(2, '0')}:00`,
  token_number: token, status: 'confirmed', queue_status: 'waiting', ...extra });
describe('Next two token notifications', () => {
  let online, notify, exists;
  const current = record('current', 1, { status: 'in-progress', queue_status: 'in_progress' });
  beforeEach(() => {
    online = sinon.stub(slotRepository, 'online').resolves([current, record('two', 2), record('three', 3), record('four', 4)]);
    sinon.stub(slotRepository, 'walkins').resolves([]);
    notify = sinon.stub(queueTurnNotificationDelivery, 'notify').resolves({ _id: 'notification' });
    exists = sinon.stub(queueTurnNotificationDelivery, 'exists').resolves(null);
  });
  afterEach(() => sinon.restore());

  it('notifies exactly the next two waiting token owners, excluding the serving patient', async () => {
    await notifyUpcomingQueuePatients(current);
    expect(notify.getCalls().map(call => call.args[0].recipientId)).to.deep.equal(['patient-two', 'patient-three']);
    expect(notify.firstCall.args[0].data).to.include({ token: 2, type: 'QUEUE_TURN_SOON', clinicId: 'clinic-1', queuePosition: 1 });
    expect(notify.firstCall.args[0].message).not.to.include('30 minutes');
    expect(notify.firstCall.args[0].title).to.equal('Your turn is next');
    expect(notify.firstCall.args[0].message).to.include('Your token 2 is next');
    expect(notify.secondCall.args[0].title).to.equal('Your turn is coming soon');
  });

  it('also alerts the second patient when called while the first consultation is running', async () => {
    online.resolves([current, record('two', 2, { queue_status: 'called' }), record('three', 3), record('four', 4)]);
    await notifyUpcomingQueuePatients(current);
    expect(notify.getCalls().map(call => call.args[0].recipientId)).to.deep.equal(['patient-two', 'patient-three']);
    expect(notify.firstCall.args[0].data.queueAlert).to.equal('NEXT_IN_LINE');
    expect(notify.secondCall.args[0].data.queueAlert).to.equal('UPCOMING');
  });

  it('sends a distinct next-in-line alert after an earlier upcoming alert and deduplicates that specific message', async () => {
    const sent = new Set(['three:UPCOMING']);
    exists.callsFake(async filter => sent.has(`${filter['data.appointmentId']}:${filter['data.queueAlert']}`) ? {} : null);
    notify.callsFake(async payload => { sent.add(`${payload.data.appointmentId}:${payload.data.queueAlert}`); return {}; });
    online.resolves([current, record('three', 3), record('four', 4)]);
    await notifyUpcomingQueuePatients(current);
    expect(notify.firstCall.args[0].recipientId).to.equal('patient-three');
    expect(notify.firstCall.args[0].message).to.include('Your token 3 is next');
    await notifyUpcomingQueuePatients(current);
    expect(notify.callCount).to.equal(2);
  });

  it('selects the first waiting tokens even when the triggering appointment is late in the queue', async () => {
    await notifyUpcomingQueuePatients(record('four', 4));
    expect(notify.getCalls().map(call => call.args[0].data.token)).to.deep.equal([2, 3]);
  });

  it('keeps clinic and doctor boundaries and excludes skipped, terminal and unassigned tokens', async () => {
    online.resolves([record('foreign', 1, { clinic_id: 'clinic-2' }), record('other', 1, { counselor: 'doctor-2' }),
      record('skip', 1, { queue_status: 'skipped' }), record('done', 1, { status: 'completed' }),
      record('no-token', null), record('two', 2), record('three', 3)]);
    await notifyUpcomingQueuePatients(current);
    expect(notify.getCalls().map(call => call.args[0].data.token)).to.deep.equal([2, 3]);
  });

  it('includes walk-ins with accounts and gives emergency and urgent tokens priority', async () => {
    slotRepository.walkins.resolves([{ _id: 'walkin', doctor_id: 'doctor-1', patient_id: 'walkin-patient',
      clinic_id: 'clinic-1', appointment_date: date, appointment_time: '11:00:00', token_number: 9,
      appointment_status: 'booked', priority: 'emergency' }]);
    online.resolves([current, record('two', 2), record('urgent', 3, { priority: 'urgent' })]);
    await notifyUpcomingQueuePatients(current);
    expect(notify.getCalls().map(call => call.args[0].recipientId)).to.deep.equal(['walkin-patient', 'patient-urgent']);
  });

  it('does not replace an unregistered next-token patient with the third waiting patient', async () => {
    online.resolves([current, record('guest', 2, { patient: null }), record('three', 3), record('four', 4)]);
    await notifyUpcomingQueuePatients(current);
    expect(notify.calledOnce).to.equal(true);
    expect(notify.firstCall.args[0].data.token).to.equal(3);
  });

  it('uses the display order, including queue positions that differ from appointment times', async () => {
    await notifyClinicDisplayPatients({ doctor_id: 'doctor-1', clinic_id: 'clinic-1' }, date, { waiting: [
      { appointmentId: 'three', patientId: 'patient-three', tokenNumber: 3, source: 'online' },
      { appointmentId: 'two', patientId: 'patient-two', tokenNumber: 2, source: 'online' },
      { appointmentId: 'four', patientId: 'patient-four', tokenNumber: 4, source: 'online' },
    ] });
    expect(notify.getCalls().map(call => call.args[0].data.token)).to.deep.equal([3, 2]);
  });

  it('does not resend persisted alerts on repeated display refreshes and sends to newly eligible tokens', async () => {
    const sent = new Set();
    exists.callsFake(async filter => sent.has(filter['data.appointmentId']) ? {} : null);
    notify.callsFake(async payload => { sent.add(payload.data.appointmentId); return {}; });
    await notifyUpcomingQueuePatients(current);
    await notifyUpcomingQueuePatients(current);
    expect(notify.callCount).to.equal(2);
    online.resolves([record('three', 3), record('four', 4)]);
    await notifyUpcomingQueuePatients(current);
    expect(notify.callCount).to.equal(3);
    expect(notify.lastCall.args[0].data.token).to.equal(4);
  });

  it('suppresses concurrent duplicate delivery and continues when one notification fails', async () => {
    notify.onFirstCall().rejects(new Error('Notification temporarily unavailable'));
    sinon.stub(console, 'error');
    await Promise.all([notifyUpcomingQueuePatients(current), notifyUpcomingQueuePatients(current)]);
    expect(notify.callCount).to.equal(2);
  });

  it('bounds notification selection to two tokens even when a caller requests more', async () => {
    await notifyNextQueueTokens([1, 2, 3].map(token => ({ id: `id-${token}`, source: 'online', token, patientId: `patient-${token}` })),
      { doctorId: 'doctor-1', date, limit: 10 });
    expect(notify.callCount).to.equal(2);
  });

  it('sends the consultation-start alert even if those patients already received a pre-start display alert', async () => {
    const sent = new Set();
    const key = (id, currentId) => `${id}:${currentId}`;
    exists.callsFake(async filter => sent.has(key(filter['data.appointmentId'], filter['data.currentAppointmentId'])) ? {} : null);
    notify.callsFake(async payload => { sent.add(key(payload.data.appointmentId, payload.data.currentAppointmentId)); return {}; });
    online.resolves([record('current', 1), record('two', 2), record('three', 3)]);
    await notifyUpcomingQueuePatients(current);
    notify.resetHistory();
    online.resolves([current, record('two', 2), record('three', 3)]);
    await notifyUpcomingQueuePatients(current);
    expect(notify.getCalls().map(call => call.args[0].recipientId)).to.deep.equal(['patient-two', 'patient-three']);
    expect(notify.firstCall.args[0].data.currentAppointmentId).to.equal('current');
    await notifyUpcomingQueuePatients(current);
    expect(notify.callCount).to.equal(2);
  });

  it('keeps the walk-in being examined out of display next tokens and alerts its two successors', async () => {
    sinon.stub(clinicDisplayQueueRepository, 'query').resolves([[]]);
    const query = records => ({ select() { return this; }, lean: async () => records });
    sinon.stub(Appointment, 'find').returns(query([]));
    sinon.stub(WalkinAppointment, 'find').returns(query([1, 2, 3, 4].map(token => ({
      _id: `walkin-${token}`, patient_id: `patient-${token}`, token_number: token,
      appointment_time: `10:${token * 10}:00`, appointment_status: token === 1 ? 'in-progress' : 'booked',
      queue_status: token === 2 ? 'called' : undefined,
    }))));
    const link = { doctor_id: 'doctor-1', clinic_id: 'clinic-1', facility_id: 'facility-1', id: 'link-1' };
    const queue = await clinicDisplayQueue(link, date);
    expect(queue.current.tokenNumber).to.equal(1);
    expect(queue.waiting.map(entry => entry.tokenNumber)).to.deep.equal([2, 3, 4]);
    await notifyClinicDisplayPatients(link, date, queue);
    expect(notify.getCalls().map(call => call.args[0].recipientId)).to.deep.equal(['patient-2', 'patient-3']);
    expect(notify.firstCall.args[0].data.currentAppointmentId).to.equal('walkin-1');
  });
});
