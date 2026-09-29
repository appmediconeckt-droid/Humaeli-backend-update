import { doctorProfileUrl } from '../src/services/qrLinks.js';
import { expect } from 'chai';
import sinon from 'sinon';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
import RegistrationOTP from '../src/models/registrationOtpModel.js';
import { completeRegistration, loginUser, getMyProfile } from '../src/controllers/authController.js';
import { generateDoctorQrCode } from '../src/services/doctorQrService.js';

const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy(), cookie: sinon.spy() });

describe('Doctor registration and optional login role', () => {
  let sandbox;
  let previousAccess, previousRefresh;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    previousAccess = process.env.ACCESS_SECRET;
    previousRefresh = process.env.REFRESH_SECRET;
    process.env.ACCESS_SECRET = 'registration-test-secret';
    process.env.REFRESH_SECRET = 'refresh-test-secret';
  });
  afterEach(() => {
    sandbox.restore();
    if (previousAccess === undefined) delete process.env.ACCESS_SECRET;
    else process.env.ACCESS_SECRET = previousAccess;
    if (previousRefresh === undefined) delete process.env.REFRESH_SECRET;
    else process.env.REFRESH_SECRET = previousRefresh;
  });

  const register = async (overrides = {}) => {
    const email = 'doctor@example.test';
    const body = {
      fullName: 'Dr Test', email, phoneNumber: '9876543210', password: 'StrongPass1!',
      qualification: 'MBBS', specialization: 'General Medicine', experience: 0,
      location: 'Delhi', accountType: 'Doctor',
      emailVerificationToken: jwt.sign({ email, purpose: 'registration_email_verified' }, process.env.ACCESS_SECRET),
      ...overrides,
    };
    sandbox.stub(User, 'findOne').resolves(null);
    const create = sandbox.stub(User, 'create').callsFake(async (data) => {
      const user = new User(data);
      await user.validate();
      return user;
    });
    sandbox.stub(RegistrationOTP, 'deleteMany').resolves({});
    const res = response();
    await completeRegistration({ body }, res);
    return { res, create };
  };

  it('persists Doctor and a PNG QR with zero years of experience', async () => {
    const { res, create } = await register();
    expect(res.status.firstCall.args[0]).to.equal(201);
    const user = res.json.firstCall.args[0].user;
    expect(user.accountType).to.equal('doctor');
    expect(user.role).to.equal('doctor');
    expect(user.experience).to.equal(0);
    expect(user.doctorQrCode).to.match(/^data:image\/png;base64,/);
    expect(Buffer.from(user.doctorQrCode.split(',')[1], 'base64').subarray(0, 8).toString('hex')).to.equal('89504e470d0a1a0a');
    expect(create.firstCall.args[0].doctorQrCode).to.equal(user.doctorQrCode);
    expect(user).not.to.have.property('password');
  });

  for (const fields of [
    { role: 'doctor', accountRole: 'doctor' },
    { role: 'Doctor' },
    { accountRole: ' Doctor ' },
  ]) {
    it(`generates a doctor QR from frontend aliases ${JSON.stringify(fields)}`, async () => {
      const { res } = await register({ accountType: undefined, ...fields });
      expect(res.status.firstCall.args[0]).to.equal(201);
      const user = res.json.firstCall.args[0].user;
      expect(user.accountType).to.equal('doctor');
      expect(user.role).to.equal('doctor');
      expect(user.doctorQrCode).to.match(/^data:image\/png;base64,/);
    });
  }

  it('rejects conflicting doctor and consultant fields', async () => {
    const { res, create } = await register({ accountType: 'consultant', role: 'doctor' });
    expect(res.status.firstCall.args[0]).to.equal(400);
    expect(create.called).to.equal(false);
  });

  it('accepts consultant aliases without generating a QR', async () => {
    const { res } = await register({ accountType: undefined, role: 'consultant', accountRole: 'consultant' });
    expect(res.status.firstCall.args[0]).to.equal(201);
    expect(res.json.firstCall.args[0].user.accountType).to.equal('consultant');
    expect(res.json.firstCall.args[0].user.doctorQrCode).to.equal(undefined);
  });

  it('persists Consultant without generating a QR', async () => {
    const qr = sandbox.spy(QRCode, 'toDataURL');
    const { res } = await register({ accountType: ' Consultant ' });
    expect(res.status.firstCall.args[0]).to.equal(201);
    expect(res.json.firstCall.args[0].user.accountType).to.equal('consultant');
    expect(res.json.firstCall.args[0].user.doctorQrCode).to.equal(undefined);
    expect(qr.called).to.equal(false);
  });

  it('preserves legacy patient signup without an account type or QR', async () => {
    const { res } = await register({ accountType: undefined, qualification: undefined, specialization: undefined, experience: undefined });
    expect(res.status.firstCall.args[0]).to.equal(201);
    expect(res.json.firstCall.args[0].user.role).to.equal('user');
    expect(res.json.firstCall.args[0].user.doctorQrCode).to.equal(undefined);
  });

  it('registers a nurse with staff fields and no doctor QR', async () => {
    const { res, create } = await register({
      accountType: undefined,
      role: 'nurse',
      qualification: undefined,
      specialization: undefined,
      experience: undefined,
      location: undefined,
      languages: undefined,
      staff_id: 'NURSE-001',
      nursing_license: 'RN-001',
      shift: 'morning',
      assigned_ward: 'Emergency',
    });
    expect(res.status.firstCall.args[0]).to.equal(201);
    const user = res.json.firstCall.args[0].user;
    expect(user.role).to.equal('nurse');
    expect(user.staffId).to.equal('NURSE-001');
    expect(user.nursingLicense).to.equal('RN-001');
    expect(user.shift).to.equal('morning');
    expect(user.assignedWard).to.equal('Emergency');
    expect(user.doctorQrCode).to.equal(undefined);
    expect(create.firstCall.args[0].role).to.equal('nurse');
  });

  it('rejects unsupported account types before creating a user', async () => {
    const { res, create } = await register({ accountType: 'admin' });
    expect(res.status.firstCall.args[0]).to.equal(400);
    expect(create.called).to.equal(false);
  });

  it('rejects doctor signup missing required professional details', async () => {
    const { res } = await register({ qualification: undefined });
    expect(res.status.firstCall.args[0]).to.equal(400);
    expect(res.json.firstCall.args[0].fields).to.include('qualification');
  });

  it('still requires verified email for doctor registration', async () => {
    const { res, create } = await register({ emailVerificationToken: 'invalid' });
    expect(res.status.firstCall.args[0]).to.equal(400);
    expect(create.called).to.equal(false);
  });

  it('does not insert a partial doctor account when QR generation fails', async () => {
    sandbox.stub(QRCode, 'toDataURL').rejects(new Error('QR generation failed'));
    const { res, create } = await register();
    expect(res.status.firstCall.args[0]).to.equal(500);
    expect(create.called).to.equal(false);
  });

  it('encodes a permanent profile URL and never generates a consultant QR', async () => {
    const encode = sandbox.stub(QRCode, 'toDataURL').resolves('png');
    const user = { _id: 'doctor-id', accountType: 'doctor', fullName: 'Dr Example', qualification: 'MBBS', specialization: ['Medicine'], password: 'secret', email: 'private@example.test' };
    await generateDoctorQrCode(user);
    expect(encode.firstCall.args[0]).to.equal(doctorProfileUrl('doctor-id'));
    expect(await generateDoctorQrCode({ ...user, accountType: 'consultant' })).to.equal(undefined);
    expect(encode.callCount).to.equal(1);
  });

  const prepareLogin = () => {
    const user = new User({ fullName: 'Doctor', email: 'doctor@example.test', role: 'doctor', accountType: 'doctor', isActive: true, password: 'hash' });
    sandbox.stub(User, 'findOne').resolves(user);
    sandbox.stub(bcrypt, 'compare').resolves(true);
    sandbox.stub(Session, 'updateMany').resolves({});
    sandbox.stub(Session, 'findOne').resolves(null);
    sandbox.stub(Session, 'create').resolves({});
    sandbox.stub(User, 'findByIdAndUpdate').resolves(null);
    return user;
  };

  it('logs in without role and uses the stored role in the token', async () => {
    prepareLogin();
    const res = response();
    await loginUser({ body: { email: 'doctor@example.test', password: 'correct' } }, res);
    expect(res.status.firstCall.args[0]).to.equal(200);
    const data = res.json.firstCall.args[0];
    expect(jwt.verify(data.accessToken, process.env.ACCESS_SECRET).role).to.equal('doctor');
    expect(data.user.accountType).to.equal('doctor');
  });

  it('still rejects an explicitly mismatched role', async () => {
    prepareLogin();
    const res = response();
    await loginUser({ body: { email: 'doctor@example.test', password: 'correct', role: 'user' } }, res);
    expect(res.status.firstCall.args[0]).to.equal(403);
    expect(Session.create.called).to.equal(false);
  });

  it('accepts an explicitly matching doctor role', async () => {
    prepareLogin();
    const res = response();
    await loginUser({ body: { email: 'doctor@example.test', password: 'correct', role: 'doctor' } }, res);
    expect(res.status.firstCall.args[0]).to.equal(200);
  });

  it('preserves the single-device check without a role', async () => {
    prepareLogin();
    Session.findOne.resolves({ isActive: true });
    const res = response();
    await loginUser({ body: { email: 'doctor@example.test', password: 'correct' } }, res);
    expect(res.status.firstCall.args[0]).to.equal(409);
    expect(Session.create.called).to.equal(false);
  });

  it('still rejects a wrong password when role is omitted', async () => {
    prepareLogin();
    bcrypt.compare.resolves(false);
    const res = response();
    await loginUser({ body: { email: 'doctor@example.test', password: 'wrong' } }, res);
    expect(res.status.firstCall.args[0]).to.equal(401);
    expect(Session.create.called).to.equal(false);
  });

  it('returns saved account type and QR in the own-profile response', async () => {
    const user = new User({ fullName: 'Doctor', role: 'doctor', accountType: 'doctor', doctorQrCode: 'saved-qr' });
    sandbox.stub(User, 'findById').returns({ select: async () => user });
    const res = response();
    await getMyProfile({ userId: user._id }, res);
    const data = res.json.firstCall.args[0];
    expect(JSON.stringify(data)).to.include('saved-qr');
    expect(JSON.stringify(data)).to.include('doctor');
  });
});
