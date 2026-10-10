import { expect } from 'chai';
import sinon from 'sinon';

// Every Firebase send is stubbed; no device receives a test notification.
process.env.GOOGLE_CLOUD_PROJECT ||= 'notification-unit-tests';
const { messaging } = await import('../src/config/firebaseAdmin.js');
const { default: User } = await import('../src/models/userModel.js');
const { default: Appointment } = await import('../src/models/appointmentModel.js');
const { default: Notification } = await import('../src/models/Notification.js');
const { default: NotificationToken } = await import('../src/models/NotificationToken.js');
const { DoctorBreak, WalkinAppointment } = await import('../src/models/clinicModels.js');
const { default: Clinic } = await import('../src/models/clinicModel.js');
const { clinicStaffRepository } = await import('../src/services/clinicStaffService.js');
const { emergencyAppointmentRepository } = await import('../src/services/emergencyAppointmentService.js');
const { book, setAppointmentEmergency, updateDoctorAppointment, updateStatus } = await import('../src/controllers/appointmentController.js');
const { updateWalkinAppointment } = await import('../src/controllers/walkinAppointmentController.js');
const { default: mongoose } = await import('../src/persistence/mongoose.js');
const { default: mysql } = await import('mysql2/promise');
const { slotRepository } = await import('../src/services/appointmentSlotService.js');
const { notifyUpcomingQueuePatients } = await import('../src/services/consultationTimingService.js');
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });
const query = value => ({ select() { return this; }, lean: async () => value, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) });

describe('Emergency appointment doctor push', () => {
  let send, row, oldIo;
  beforeEach(() => {
    oldIo = global.io; global.io = undefined;
    send = sinon.stub(messaging, 'send').resolves('mock-push-id');
    row = { _id: 'appointment-1', counselor: 'doctor-1', patient: 'patient-1', clinic_id: 'clinic-1',
      date: new Date(), appointment_date: '2026-10-09', status: 'pending', priority: 'normal', queue_status: 'waiting',
      save: sinon.stub().resolves(), toObject() { return { ...this }; }, toJSON() { return { ...this }; } };
    sinon.stub(User, 'findById').callsFake(id => query({ role: id === 'doctor-1' ? 'doctor' : 'nurse', assignedDoctor: 'doctor-1', isActive: true }));
    sinon.stub(Appointment, 'findOne').resolves(row);
    sinon.stub(Appointment, 'findById').resolves(row);
    sinon.stub(DoctorBreak, 'findOne').resolves(null);
    sinon.stub(Notification, 'create').callsFake(async data => ({ _id: 'notification-1', toObject: () => data }));
    sinon.stub(NotificationToken, 'find').callsFake(({ userId }) => query(userId === 'doctor-1' ? [{ token: 'doctor-device' }] : []));
    sinon.stub(User, 'findOne').returns(query({ _id: 'doctor-1', role: 'doctor' }));
    sinon.stub(User, 'find').returns(query([]));
    sinon.stub(Clinic, 'findOne').resolves({ id: 'clinic-1', doctor_id: 'doctor-1' });
    sinon.stub(emergencyAppointmentRepository, 'query').resolves([[{ Field: 'priority', Type: 'varchar(64)' }]]);
    sinon.stub(clinicStaffRepository, 'query').resolves([[{ Field: 'clinic_id' }]]);
    sinon.stub(clinicStaffRepository, 'connection').resolves({ query: sinon.stub().resolves([[{ acquired: 1 }]]), release() {} });
    sinon.stub(Appointment, 'create').callsFake(async data => ({ ...data, _id: 'new-emergency' }));
    sinon.stub(slotRepository, 'online').resolves([]);
    sinon.stub(slotRepository, 'walkins').resolves([]);
  });
  afterEach(() => { sinon.restore(); global.io = oldIo; });
  const mark = async (body = {}) => {
    const res = response();
    await setAppointmentEmergency({ user: { _id: 'staff-1' }, params: { id: row._id }, body }, res);
    return res;
  };

  it('pushes a newly booked emergency to its assigned doctor only, without the medical reason', async () => {
    Appointment.findOne.resolves(null);
    const res = response();
    await book({ user: { _id: 'patient-1' }, body: { counselorId: 'doctor-1', clinic_id: 'clinic-1', priority: 'emergency', emergency_reason: 'PRIVATE EMERGENCY REASON' } }, res);
    expect(res.statusCode).to.equal(201);
    expect(send.calledOnce).to.equal(true);
    expect(send.firstCall.args[0].token).to.equal('doctor-device');
    expect(send.firstCall.args[0].data).to.include({ priority: 'emergency', doctorId: 'doctor-1', appointmentId: 'new-emergency', type: 'APPOINTMENT' });
    expect(JSON.stringify(send.firstCall.args[0])).not.to.include('PRIVATE EMERGENCY REASON');
    expect(NotificationToken.find.firstCall.args[0]).to.deep.equal({ userId: 'doctor-1', active: true });
  });

  it('pushes when staff marks an existing appointment as emergency and does not resend on repeated marking', async () => {
    expect((await mark()).statusCode).to.equal(200);
    expect(send.calledOnce).to.equal(true);
    expect(row.save.calledOnce).to.equal(true);
    expect(send.firstCall.args[0].data.appointmentId).to.equal(row._id);
    await mark();
    expect(send.calledOnce).to.equal(true);
  });

  it('does not send a doctor emergency push when removing emergency priority or the record is missing', async () => {
    row.priority = 'emergency';
    await mark({ is_emergency: false });
    Appointment.findOne.resolves(null);
    expect((await mark()).statusCode).to.equal(404);
    expect(send.called).to.equal(false);
  });

  it('does not push or save when staff tries to access a different doctor', async () => {
    expect((await mark({ doctor_id: 'doctor-2' })).statusCode).to.equal(403);
    expect(row.save.called).to.equal(false);
    expect(send.called).to.equal(false);
  });

  it('keeps the emergency update successful when push delivery fails', async () => {
    send.rejects(new Error('Firebase unavailable'));
    sinon.stub(console, 'error');
    const res = await mark();
    expect(res.statusCode).to.equal(200);
    expect(row.priority).to.equal('emergency');
    expect(Notification.create.getCalls().map(call => call.args[0].recipientId)).to.deep.equal(['doctor-1', 'patient-1']);
  });

  it('also pushes for emergency priority set through the doctor update endpoint', async () => {
    const res = response();
    await updateDoctorAppointment({ user: { _id: 'doctor-1' }, params: { id: row._id }, body: { priority: 'emergency' } }, res);
    expect(res.statusCode).to.equal(200);
    expect(send.calledOnce).to.equal(true);
    expect(send.firstCall.args[0].token).to.equal('doctor-device');
    await updateDoctorAppointment({ user: { _id: 'doctor-1' }, params: { id: row._id }, body: { priority: 'emergency' } }, response());
    expect(send.calledOnce).to.equal(true);
  });

  it('sends actual FCM payloads to both next token owners and no other patient', async () => {
    sinon.stub(Notification, 'exists').resolves(null);
    slotRepository.online.resolves([1, 2, 3, 4].map(token => ({
      _id: `appointment-${token}`, counselor: 'doctor-1', patient: `patient-${token}`,
      appointment_date: row.appointment_date, clinic_id: 'clinic-1', appointment_time: `10:${token * 10}:00`,
      token_number: token, status: token === 1 ? 'in-progress' : 'confirmed',
      queue_status: token === 1 ? 'in_progress' : 'waiting',
    })));
    NotificationToken.find.callsFake(({ userId }) => query([{ token: `${userId}-device` }]));
    await notifyUpcomingQueuePatients(row);
    expect(send.getCalls().map(call => call.args[0].token)).to.deep.equal(['patient-2-device', 'patient-3-device']);
    expect(send.firstCall.args[0].data).to.include({ type: 'QUEUE_TURN_SOON', token: '2', clinicId: 'clinic-1' });
    expect(send.firstCall.args[0].notification.title).to.equal('Your turn is next');
  });

  for (const source of ['online', 'walkin']) {
    it(`sends to the next two patients through the actual ${source} consultation-start controller`, async () => {
      const doctorId = '507f1f77bcf86cd799439011';
      const clinicId = '507f1f77bcf86cd799439012';
      const previousDb = mongoose.connection.db;
      mongoose.connection.db = { pool: {}, databaseName: 'unit-test' };
      try {
        sinon.stub(mysql, 'createConnection').resolves({ execute: sinon.stub().resolves([[{ acquired: 1 }]]), end: sinon.stub().resolves() });
        sinon.stub(Notification, 'exists').resolves(null);
        User.findById.callsFake(() => query({ role: 'doctor', isActive: true }));
        NotificationToken.find.callsFake(({ userId }) => query(String(userId) === 'patient-2' || String(userId) === 'patient-3'
          ? [{ token: `${userId}-device` }] : []));
        const next = [2, 3, 4].map(token => ({ _id: `next-${token}`, counselor: doctorId, patient: `patient-${token}`,
          clinic_id: clinicId, appointment_date: row.appointment_date, appointment_time: `10:${token * 10}:00`,
          date: new Date(`2026-10-09T10:${token * 10}:00+05:30`), token_number: token, status: 'confirmed', queue_status: 'waiting' }));
        Object.assign(row, { counselor: doctorId, doctor_id: source === 'walkin' ? doctorId : undefined,
          clinic_id: clinicId, appointment_time: '10:00:00', date: new Date('2026-10-09T10:00:00+05:30'),
          appointment_status: source === 'walkin' ? 'booked' : undefined, token_number: 1,
          validate: sinon.stub().resolves() });
        slotRepository.online.callsFake(async () => source === 'online' ? [row, ...next] : next);
        slotRepository.walkins.callsFake(async () => source === 'walkin' ? [row] : []);
        sinon.stub(Appointment, 'find').returns(query([]));
        sinon.stub(WalkinAppointment, 'find').returns(query([]));
        sinon.stub(WalkinAppointment, 'findOne').resolves(row);
        sinon.stub(slotRepository, 'ranges').resolves([]);
        const res = response();
        const req = { user: { _id: doctorId }, params: { id: row._id }, body: { status: 'in-progress' } };
        await (source === 'online' ? updateStatus : updateWalkinAppointment)(req, res);
        expect(res.statusCode).to.equal(200);
        expect(row.save.calledOnce).to.equal(true);
        expect(send.getCalls().map(call => call.args[0].token)).to.deep.equal(['patient-2-device', 'patient-3-device']);
        expect(send.firstCall.args[0].data).to.include({ type: 'QUEUE_TURN_SOON', currentAppointmentId: row._id, token: '2' });
      } finally { mongoose.connection.db = previousDb; }
    });
  }
});
