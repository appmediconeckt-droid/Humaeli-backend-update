import { expect } from 'chai';
import sinon from 'sinon';
import { Query } from 'mingo';
import User from '../src/models/userModel.js';
import Message from '../src/models/Message.js';
import { getAllCounsellors, getCounsellorById } from '../src/controllers/authController.js';

const doctorId = '6aa91e059b2c9409947d9396';
const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy() });
const profiles = [
  { _id: doctorId, role: 'doctor', isActive: true, profileCompleted: true, experience: 0, specialization: ['Medicine'], location: 'Delhi', consultationMode: ['online'] },
  { _id: 'consultant', role: 'consultant', isActive: true, profileCompleted: true, experience: 2 },
  { _id: 'account-type-consultant', role: 'counsellor', accountType: 'consultant', isActive: true, profileCompleted: false, experience: 1 },
  { _id: 'counsellor', role: 'counsellor', isActive: true, profileCompleted: true, experience: 3 },
  { _id: 'inactive', role: 'doctor', isActive: false, profileCompleted: true },
  { _id: 'incomplete', role: 'doctor', isActive: true, profileCompleted: false },
  { _id: 'patient', role: 'user', isActive: true, profileCompleted: true },
];

describe('Professional counsellor directory', () => {
  afterEach(() => sinon.restore());

  function stubDirectory() {
    sinon.stub(User, 'find').callsFake(filter => ({
      select: sinon.stub().returns({ sort: () => ({ lean: async () => profiles.filter(p => new Query(filter).test(p)) }) }),
    }));
    sinon.stub(User, 'findOne').callsFake(async filter => {
      const found = profiles.find(p => new Query(filter).test(p));
      return found ? { toJSON: () => ({ ...found }) } : null;
    });
    sinon.stub(Message, 'aggregate').resolves([]);
  }

  it('lists active doctors and consultants, including older incomplete profiles and zero experience', async () => {
    stubDirectory();
    const res = response();
    await getAllCounsellors({ query: {} }, res);
    expect(res.status.calledWith(200)).to.equal(true);
    expect(res.json.firstCall.args[0].counsellors.map(p => [p._id, p.role])).to.deep.equal([
      [doctorId, 'doctor'], ['consultant', 'consultant'], ['account-type-consultant', 'counsellor'], ['counsellor', 'counsellor'],
      ['incomplete', 'doctor'],
    ]);
    expect(res.json.firstCall.args[0].professionals.map(p => p._id)).to.deep.equal([doctorId, 'consultant', 'account-type-consultant', 'counsellor', 'incomplete']);
    expect(res.json.firstCall.args[0].doctors.map(p => p._id)).to.deep.equal([doctorId, 'incomplete']);
    expect(res.json.firstCall.args[0].consultants.map(p => p._id)).to.deep.equal(['consultant', 'account-type-consultant', 'counsellor']);
    expect(User.find.firstCall.returnValue.select.firstCall.args[0]).to.include('-aadhaarNumber');
    expect(Message.aggregate.firstCall.args[0][0].$match.senderRole.$in).to.include.members(['consultant', 'counsellor', 'doctor']);
  });

  for (const profile of profiles) {
    it(`uses the same eligibility for detail: ${profile._id}`, async () => {
      stubDirectory();
      const res = response();
      await getCounsellorById({ params: { counsellorId: profile._id } }, res);
      const eligible = [doctorId, 'consultant', 'account-type-consultant', 'counsellor', 'incomplete'].includes(profile._id);
      expect(res.status.calledWith(eligible ? 200 : 404)).to.equal(true);
      if (eligible) expect(res.json.firstCall.args[0].counsellor.role).to.equal(profile.role);
    });
  }

  it('continues applying optional directory filters', async () => {
    stubDirectory();
    const res = response();
    await getAllCounsellors({ query: { specialization: 'Medicine', location: 'delhi', consultationMode: 'online', minExperience: '0' } }, res);
    expect(res.json.firstCall.args[0].counsellors.map(p => p._id)).to.deep.equal([doctorId]);
    const experienced = response();
    await getAllCounsellors({ query: { minExperience: '1' } }, experienced);
    expect(experienced.json.firstCall.args[0].counsellors.map(p => p._id)).to.deep.equal(['consultant', 'account-type-consultant', 'counsellor']);
  });
});
