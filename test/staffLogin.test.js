import { expect } from 'chai';
import sinon from 'sinon';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../src/models/userModel.js';
import Clinic from '../src/models/clinicModel.js';
import Session from '../src/models/sessionModel.js';
import { loginUser, getMyProfile, changePassword } from '../src/controllers/authController.js';
import { staffRoles } from '../src/utils/clinicAccess.js';
import { allowRoles } from '../src/middleware/authMiddleware.js';
import { addStaff } from '../src/controllers/staffController.js';
import { staffWelcomeEmailDelivery } from '../src/services/staffWelcomeEmailService.js';

const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy(), cookie: sinon.spy() });

describe('Doctor-created staff login', () => {
  let sandbox, accessSecret, refreshSecret;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    accessSecret = process.env.ACCESS_SECRET;
    refreshSecret = process.env.REFRESH_SECRET;
    process.env.ACCESS_SECRET = 'staff-login-test-secret';
    process.env.REFRESH_SECRET = 'staff-refresh-test-secret';
  });
  afterEach(() => {
    sandbox.restore();
    if (accessSecret === undefined) delete process.env.ACCESS_SECRET;
    else process.env.ACCESS_SECRET = accessSecret;
    if (refreshSecret === undefined) delete process.env.REFRESH_SECRET;
    else process.env.REFRESH_SECRET = refreshSecret;
  });
  const prepare = (role = 'nurse') => {
    const user = new User({ fullName: 'Staff Member', email: 'staff@example.test', phoneNumber: '9876543210', role, assignedDoctor: '111111111111111111111111', clinic_id: '222222222222222222222222', isActive: true, password: 'hash', isEmailVerified: false, profileCompleted: true });
    sandbox.stub(User, 'findOne').resolves(user);
    sandbox.stub(bcrypt, 'compare').resolves(true);
    sandbox.stub(Session, 'updateMany').resolves({});
    sandbox.stub(Session, 'findOne').resolves(null);
    sandbox.stub(Session, 'create').resolves({});
    sandbox.stub(User, 'findByIdAndUpdate').resolves(null);
    return user;
  };

  for (const role of staffRoles) {
    it(`accepts the password saved when a doctor creates ${role}`, async () => {
      const doctorId = '111111111111111111111111';
      const clinicId = '222222222222222222222222';
      let created;
      sandbox.stub(User, 'findById').returns({ select: async () => ({ role: 'doctor', isActive: true }) });
      sandbox.stub(User, 'exists').resolves(false);
      sandbox.stub(Clinic, 'findOne').resolves({ _id: clinicId, clinic_name: 'Clinic' });
      sandbox.stub(User, 'create').callsFake(async (data) => (created = new User(data)));
      sandbox.stub(staffWelcomeEmailDelivery, 'send').resolves({ messageId: 'mock' });
      const creation = response();
      await addStaff({ userId: doctorId, body: { full_name: 'Staff', email: 'staff@example.test', contact_number: '9876543210', password: 'StrongStaff1!', role, clinic_id: clinicId } }, creation);
      expect(creation.status.calledWith(201)).to.equal(true);
      expect(created.password).not.to.equal('StrongStaff1!');
      sandbox.stub(User, 'findOne').resolves(created);
      sandbox.stub(Session, 'updateMany').resolves({});
      sandbox.stub(Session, 'findOne').resolves(null);
      sandbox.stub(Session, 'create').resolves({});
      sandbox.stub(User, 'findByIdAndUpdate').resolves(null);
      const login = response();
      await loginUser({ body: { email: created.email, password: 'StrongStaff1!' } }, login);
      expect(login.status.calledWith(200)).to.equal(true);
      expect(login.json.firstCall.args[0].role).to.equal(role);
    });

    it(`logs in ${role} with the doctor's password, preserving role and assignment`, async () => {
      const user = prepare(role);
      const res = response();
      await loginUser({ body: { email: ' Staff@Example.Test ', password: 'correct' } }, res);
      expect(res.status.firstCall.args[0]).to.equal(200);
      const data = res.json.firstCall.args[0];
      expect(jwt.verify(data.accessToken, process.env.ACCESS_SECRET).role).to.equal(role);
      expect(jwt.verify(data.refreshToken, process.env.REFRESH_SECRET).role).to.equal(role);
      expect(String(data.user.assignedDoctor)).to.equal(String(user.assignedDoctor));
      expect(data.user).not.to.have.property('password');
      expect(data.role).to.equal(role);
      const denied = response();
      const next = sinon.spy();
      allowRoles('doctor', 'admin')({ user }, denied, next);
      expect(denied.status.calledWith(403)).to.equal(true);
      expect(next.called).to.equal(false);
    });

    it(`returns ${role}'s own profile and only its assigned clinic`, async () => {
      const user = prepare(role);
      sandbox.stub(User, 'findById').returns({ select: async () => user });
      User.findOne.returns({ select: async () => ({ fullName: 'Assigned Doctor' }) });
      const clinic = sandbox.stub(Clinic, 'findOne').returns({ select: async () => ({ clinic_name: 'Assigned Clinic' }) });
      const res = response();
      await getMyProfile({ userId: user._id }, res);
      expect(res.status.calledWith(200)).to.equal(true);
      const data = res.json.firstCall.args[0].user;
      expect(data.role).to.equal(role);
      expect(data.clinic_name).to.equal('Assigned Clinic');
      expect(data.assignedDoctorName).to.equal('Assigned Doctor');
      expect(String(clinic.firstCall.args[0].doctor_id)).to.equal(String(user.assignedDoctor));
      expect(String(clinic.firstCall.args[0]._id)).to.equal(String(user.clinic_id));
      expect(data).not.to.have.property('password');
    });
  }

  it('rejects wrong passwords and creates no session', async () => {
    prepare();
    bcrypt.compare.resolves(false);
    const res = response();
    await loginUser({ body: { email: 'staff@example.test', password: 'wrong' } }, res);
    expect(res.status.calledWith(401)).to.equal(true);
    expect(Session.create.called).to.equal(false);
  });
  it('rejects deactivated staff and creates no session', async () => {
    const user = prepare(); user.isActive = false;
    const res = response();
    await loginUser({ body: { email: 'staff@example.test', password: 'correct' } }, res);
    expect(res.status.calledWith(401)).to.equal(true);
    expect(Session.create.called).to.equal(false);
  });
  it('preserves the one-device policy for staff', async () => {
    prepare(); Session.findOne.resolves({ isActive: true });
    const res = response();
    await loginUser({ body: { email: 'staff@example.test', password: 'correct' } }, res);
    expect(res.status.calledWith(409)).to.equal(true);
    expect(Session.create.called).to.equal(false);
  });
  it('does not let a requested doctor role promote staff', async () => {
    prepare();
    const res = response();
    await loginUser({ body: { email: 'staff@example.test', password: 'correct', role: 'doctor' } }, res);
    expect(res.status.calledWith(403)).to.equal(true);
    expect(res.json.firstCall.args[0].actualRole).to.equal('nurse');
    expect(Session.create.called).to.equal(false);
  });
  it('lets staff replace the temporary password and requires login again', async () => {
    const user = prepare();
    sandbox.stub(User, 'findById').returns({ select: async () => user });
    sandbox.stub(user, 'save').resolves(user);
    bcrypt.compare.onFirstCall().resolves(true).onSecondCall().resolves(false);
    sandbox.stub(bcrypt, 'hash').resolves('new-password-hash');
    const res = response();
    await changePassword({ user, body: { oldPassword: 'old', newPassword: 'StrongNew1!' } }, res);
    expect(res.status.calledWith(200)).to.equal(true);
    expect(user.password).to.equal('new-password-hash');
    expect(Session.updateMany.calledOnce).to.equal(true);
    expect(Session.updateMany.firstCall.args[1].isActive).to.equal(false);
  });
});
