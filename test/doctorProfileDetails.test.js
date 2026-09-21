import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import { updateUserById, getMyProfile, getProfileById, getUsers } from '../src/controllers/authController.js';

const address = { line1: 'Test street', city: 'Delhi', state: 'Delhi', pincode: '110001', country: 'India' };
const complete = () => new User({ fullName: 'Test Doctor', email: 'doctor@example.test', role: 'doctor', phoneNumber: '9876543210', phoneCountryCode: '+91', profilePhoto: { url: 'https://example.test/photo.jpg' }, dateOfBirth: '1990-01-01', gender: 'male', specialization: ['Medicine'], experience: 3, qualification: 'MBBS', aboutMe: 'About doctor', languages: ['Hindi'], consultationMode: ['online'], certifications: [{ name: 'Degree', documentUrl: 'https://example.test/degree.jpg' }], aadhaarNumber: '123456789012', panNumber: 'ABCDE1234F', permanentAddress: address });
const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy() });
describe('Doctor profile details and completion', () => {
  afterEach(() => sinon.restore());
  async function update(body, current = complete()) {
    sinon.stub(User, 'findById').resolves(current);
    const save = sinon.stub(User, 'findByIdAndUpdate').callsFake((id, change) => ({ select: async () => new User({ ...current.toObject(), ...change.$set }) }));
    const res = response();
    await updateUserById({ params: { userId: current._id }, body, files: {} }, res);
    return { res, save };
  }
  it('saves doctor professional fields, identity aliases and multipart address and completes the profile', async () => {
    const { res, save } = await update({ about: 'Updated about', aadharNumber: '1234 5678 9012', pan: 'abcde1234f', permanentAddress: JSON.stringify(address), languages: '["Hindi","English"]' });
    expect(res.status.calledWith(200)).to.equal(true);
    expect(save.firstCall.args[1].$set).to.include({ aboutMe: 'Updated about', aadhaarNumber: '123456789012', panNumber: 'ABCDE1234F', profileCompleted: true });
    expect(res.json.firstCall.args[0].user).to.include({ about: 'Updated about', aadhaarNumber: '123456789012', panNumber: 'ABCDE1234F' });
  });
  for (const field of ['aadhaarNumber', 'panNumber', 'permanentAddress', 'aboutMe']) {
    it(`does not allow profileCompleted to bypass missing ${field}`, async () => {
      const { save } = await update({ [field]: '', profileCompleted: true });
      expect(save.firstCall.args[1].$set.profileCompleted).to.equal(false);
    });
  }
  it('allows a doctor with zero years of experience to complete their profile', async () => {
    const { save } = await update({ experience: 0 });
    expect(save.firstCall.args[1].$set.profileCompleted).to.equal(true);
  });
  it('rejects malformed identity details without saving', async () => {
    const { res, save } = await update({ aadhaarNumber: '123' });
    expect(res.status.calledWith(400)).to.equal(true);
    expect(save.called).to.equal(false);
  });
  it('returns private details from the own-profile API and omits them from ordinary serialization', async () => {
    const user = complete();
    sinon.stub(User, 'findById').returns({ select: async () => user });
    const res = response();
    await getMyProfile({ userId: user._id }, res);
    expect(res.json.firstCall.args[0].user).to.include({ aadhaarNumber: '123456789012', panNumber: 'ABCDE1234F', about: 'About doctor' });
    expect(res.json.firstCall.args[0].user.permanentAddress).to.deep.equal(address);
    expect(user.toJSON()).not.to.have.any.keys('aadhaarNumber', 'panNumber', 'permanentAddress');
  });
  it('only lists completed active professionals to patients', async () => {
    const find = sinon.stub(User, 'find').returns({ select: () => ({ lean: async () => [] }) });
    await getUsers({ query: { role: 'doctor' }, user: { role: 'user' } }, response());
    expect(find.firstCall.args[0]).to.deep.equal({ role: 'doctor', isActive: true, profileCompleted: true });
  });
  it('does not expose incomplete doctor public profiles', async () => {
    const find = sinon.stub(User, 'findOne').returns({ select: () => ({ lean: async () => null }) });
    const res = response();
    await getProfileById({ params: { id: 'doctor' }, query: {} }, res);
    expect(find.firstCall.args[0].profileCompleted).to.equal(true);
    expect(res.status.calledWith(404)).to.equal(true);
  });
});
