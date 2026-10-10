import { expect } from 'chai';
import sinon from 'sinon';
import bcrypt from 'bcryptjs';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
import { addStaff, resendStaffWelcomeEmail, updateStaff, listStaff, removeStaff } from '../src/controllers/staffController.js';
import Clinic from '../src/models/clinicModel.js';
import { changePassword } from '../src/controllers/authController.js';
import { staffWelcomeEmailDelivery, sendStaffWelcomeEmail } from '../src/services/staffWelcomeEmailService.js';

const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });

describe('Staff temporary password email', () => {
  let created, send;
  const password = 'Temp@12345';
  const request = () => ({ user: { _id: 'doctor-1' }, body: {
    role: 'nurse', fullName: 'New Staff', email: ' Staff@Example.test ', phoneNumber: '9876543210', password,
  } });
  beforeEach(() => {
    sinon.stub(User, 'findById').returns({ select: async () => ({ role: 'doctor', isActive: true }) });
    sinon.stub(User, 'exists').resolves(false);
    created = sinon.stub(User, 'create').callsFake(async data => {
      const user = new User(data);
      return user;
    });
    send = sinon.stub(staffWelcomeEmailDelivery, 'send').resolves({ messageId: 'mock-mail' });
    sinon.stub(staffWelcomeEmailDelivery, 'wait').resolves();
  });
  afterEach(() => sinon.restore());

  it('emails the saved staff password to the normalized staff address and only stores its hash', async () => {
    const res = response();
    await addStaff(request(), res);
    expect(res.statusCode).to.equal(201);
    expect(res.body.emailSent).to.equal(true);
    expect(send.calledOnce).to.equal(true);
    expect(send.firstCall.args[0].to).to.equal('staff@example.test');
    expect(send.firstCall.args[0].text).to.include(`Temporary password: ${password}`).and.to.include('Settings');
    expect(await bcrypt.compare(password, created.firstCall.args[0].password)).to.equal(true);
    expect(created.firstCall.args[0].assignedDoctor).to.equal('doctor-1');
    expect(JSON.stringify(res.body)).not.to.include(password);
    expect(res.body.user).not.to.have.property('password');
  });

  it('keeps a created account and reports mail failure without exposing provider errors or passwords', async () => {
    send.rejects(new Error(`Provider error containing ${password}`));
    const log = sinon.stub(console, 'error');
    const res = response();
    await addStaff(request(), res);
    expect(res.statusCode).to.equal(201);
    expect(created.calledOnce).to.equal(true);
    expect(res.body.emailSent).to.equal(false);
    expect(res.body.message).to.include('Forgot Password');
    expect(JSON.stringify(res.body)).not.to.include(password);
    expect(log.firstCall.args.join(' ')).not.to.include(password);
  });

  it('does not email when validation, duplicate lookup, or account persistence fails', async () => {
    const invalid = request(); invalid.body.password = 'weak';
    expect((await addStaff(invalid, response())).statusCode).to.equal(400);
    User.exists.resolves(true);
    expect((await addStaff(request(), response())).statusCode).to.equal(409);
    User.exists.resolves(false);
    created.rejects(new Error('Save failed'));
    sinon.stub(console, 'error');
    expect((await addStaff(request(), response())).statusCode).to.equal(500);
    expect(send.called).to.equal(false);
  });

  it('escapes names and passwords in HTML while preserving the exact plain-text credentials', async () => {
    await sendStaffWelcomeEmail({ email: 'staff@example.test', fullName: '<script>alert(1)</script>', password: 'Temp<&123A' });
    expect(send.firstCall.args[0].html).not.to.include('<script>');
    expect(send.firstCall.args[0].html).to.include('Temp&lt;&amp;123A');
    expect(send.firstCall.args[0].text).to.include('Temp<&123A');
  });

  it('allows staff to change the emailed password through the existing password endpoint', async () => {
    const staff = { _id: 'staff-1', password: await bcrypt.hash(password, 10), save: sinon.stub().resolves() };
    User.findById.returns({ select: async () => staff });
    sinon.stub(Session, 'updateMany').resolves({});
    const res = response();
    await changePassword({ user: { _id: staff._id, role: 'nurse' }, body: { oldPassword: password, newPassword: 'Changed@12345' } }, res);
    expect(res.statusCode).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(await bcrypt.compare('Changed@12345', staff.password)).to.equal(true);
    expect(await bcrypt.compare(password, staff.password)).to.equal(false);
  });

  it('retries transient email failures and returns success only after the provider accepts', async () => {
    send.onFirstCall().rejects(Object.assign(new Error('SMTP unavailable'), { code: 'ETIMEDOUT' }));
    send.onSecondCall().resolves({ messageId: 'accepted', accepted: ['staff@example.test'] });
    const res = response();
    await addStaff(request(), res);
    expect(send.callCount).to.equal(2);
    expect(res.body.emailSent).to.equal(true);
  });

  it('does not mark rejected recipients or authentication failures as delivered', async () => {
    send.resolves({ accepted: [], rejected: ['staff@example.test'] });
    const rejected = response(); await addStaff(request(), rejected);
    expect(rejected.body.emailSent).to.equal(false);
    expect(send.callCount).to.equal(1);
    send.resetHistory();
    send.rejects(Object.assign(new Error('Invalid SMTP credentials'), { code: 'EAUTH' }));
    const invalidAuth = response(); await addStaff(request(), invalidAuth);
    expect(invalidAuth.body.emailSent).to.equal(false);
    expect(send.callCount).to.equal(1);
  });

  it('resends the existing temporary password only to an owned active staff account without changing it', async () => {
    const staff = { email: 'staff@example.test', fullName: 'Staff', password: await bcrypt.hash(password, 10) };
    const find = sinon.stub(User, 'findOne').returns({ select: async () => staff });
    const res = response();
    await resendStaffWelcomeEmail({ ...request(), params: { id: 'staff-1' } }, res);
    expect(res.body.emailSent).to.equal(true);
    expect(find.firstCall.args[0]).to.include({ _id: 'staff-1', assignedDoctor: 'doctor-1', isActive: true });
    expect(send.firstCall.args[0].to).to.equal(staff.email);
    expect(await bcrypt.compare(password, staff.password)).to.equal(true);
    expect(created.called).to.equal(false);
  });

  it('refuses resending changed passwords or another doctor staff credentials', async () => {
    const find = sinon.stub(User, 'findOne').returns({ select: async () => ({ password: await bcrypt.hash('Changed@12345', 10) }) });
    const changed = response();
    await resendStaffWelcomeEmail({ ...request(), params: { id: 'staff-1' } }, changed);
    expect(changed.statusCode).to.equal(400);
    find.returns({ select: async () => null });
    const foreign = response();
    await resendStaffWelcomeEmail({ ...request(), params: { id: 'staff-2' } }, foreign);
    expect(foreign.statusCode).to.equal(404);
    expect(send.called).to.equal(false);
  });

  it('saves staff under the selected clinic owned by the authenticated doctor', async () => {
    const clinicId = '507f1f77bcf86cd799439011';
    const lookup = sinon.stub(Clinic, 'findOne').resolves({ _id: clinicId, clinic_name: 'Clinic A' });
    const req = request(); req.body.clinic_id = clinicId;
    const res = response(); await addStaff(req, res);
    expect(res.statusCode).to.equal(201);
    expect(lookup.firstCall.args[0]).to.deep.equal({ _id: clinicId, doctor_id: 'doctor-1' });
    expect(created.firstCall.args[0]).to.include({ clinic_id: clinicId, assignedDoctor: 'doctor-1' });
    expect(String(res.body.user.clinic_id)).to.equal(clinicId);
    expect(res.body.user.clinic_name).to.equal('Clinic A');
  });

  it('rejects another doctor clinic before creating staff or sending credentials', async () => {
    sinon.stub(Clinic, 'findOne').resolves(null);
    const req = request(); req.body.clinic_id = '507f1f77bcf86cd799439011';
    const res = response(); await addStaff(req, res);
    expect(res.statusCode).to.equal(404);
    expect(created.called).to.equal(false);
    expect(send.called).to.equal(false);
  });

  it('persists changing staff clinic and refuses moving staff to another doctor clinic', async () => {
    const clinicId = '507f1f77bcf86cd799439012';
    const staff = new User({ fullName: 'Staff', role: 'nurse', assignedDoctor: '507f1f77bcf86cd799439013' });
    const save = sinon.stub(staff, 'save').resolves(staff);
    sinon.stub(User, 'findOne').resolves(staff);
    const lookup = sinon.stub(Clinic, 'findOne').resolves({ _id: clinicId, clinic_name: 'Clinic B' });
    const req = { ...request(), params: { id: String(staff._id) }, body: { clinic_id: clinicId, fullName: 'Updated Staff', role: 'lab_technician' } };
    const res = response(); await updateStaff(req, res);
    expect(res.statusCode).to.equal(200);
    expect(String(res.body.user.clinic_id)).to.equal(clinicId);
    expect(res.body.user.role).to.equal('lab_technician');
    expect(save.calledOnce).to.equal(true);
    lookup.resolves(null);
    const foreign = response(); await updateStaff(req, foreign);
    expect(foreign.statusCode).to.equal(404);
    expect(save.calledOnce).to.equal(true);
  });

  it('excludes deleted staff from fresh GET responses and invalidates their active sessions', async () => {
    const staff = new User({ fullName: 'Deleted Staff', role: 'nurse', isActive: true });
    const list = sinon.stub(User, 'find').callsFake(async filter =>
      filter.isActive === true && !staff.isActive ? [] : [staff]);
    sinon.stub(Clinic, 'find').resolves([]);
    sinon.stub(User, 'findOneAndUpdate').callsFake(async (filter, update) => {
      Object.assign(staff, update.$set); return staff;
    });
    const sessions = sinon.stub(Session, 'updateMany').resolves({});
    const req = { ...request(), params: { id: String(staff._id) } };
    const before = response(); await listStaff(req, before);
    expect(before.body.data.length).to.equal(1);
    const deleted = response(); await removeStaff(req, deleted);
    expect(deleted.body.success).to.equal(true);
    const refreshed = response(); await listStaff(req, refreshed);
    expect(refreshed.body.data).to.deep.equal([]);
    expect(list.lastCall.args[0]).to.include({ assignedDoctor: 'doctor-1', isActive: true });
    expect(sessions.firstCall.args[0]).to.deep.equal({ userId: staff._id, isActive: true });
  });
});
