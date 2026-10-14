import { expect } from 'chai';
import sinon from 'sinon';
import bcrypt from 'bcryptjs';
import User from '../src/models/userModel.js';
import ForgotPasswordToken from '../src/models/ForgotPasswordToken.js';
import { resetPassword } from '../src/controllers/forgotPasswordController.js';

describe('Password reset with legacy location history', () => {
  afterEach(() => sinon.restore());

  it('resets the password without validating unchanged legacy history', async () => {
    const user = User.hydrate({
      _id: '507f1f77bcf86cd799439011', fullName: 'Test Patient', email: 'patient@example.com',
      phoneNumber: '+919999999999', role: 'user', password: 'old-hash',
      locationData: { history: [{ event: 'legacy-profile' }] },
    });
    sinon.stub(User, 'findOne').resolves(user);
    sinon.stub(ForgotPasswordToken, 'findOne').returns({ sort: async () => ({ isExpired: () => false }) });
    const remove = sinon.stub(ForgotPasswordToken, 'deleteMany').resolves({});
    const save = sinon.stub(user, 'save').callsFake(async (options) => {
      await user.validate(options);
      return user;
    });
    const res = { status: sinon.stub().returnsThis(), json: sinon.stub().returnsThis() };
    await resetPassword({ body: { email: user.email, newPassword: 'StrongPass123!', confirmPassword: 'StrongPass123!' } }, res);
    expect(res.status.calledWith(200)).to.equal(true);
    expect(save.calledWith({ validateModifiedOnly: true })).to.equal(true);
    expect(await bcrypt.compare('StrongPass123!', user.password)).to.equal(true);
    expect(user.locationData.history[0].event).to.equal('legacy-profile');
    expect(remove.calledOnce).to.equal(true);
  });

  it('still rejects weak passwords before loading the user', async () => {
    const find = sinon.stub(User, 'findOne');
    const res = { status: sinon.stub().returnsThis(), json: sinon.stub().returnsThis() };
    await resetPassword({ body: { email: 'patient@example.com', newPassword: 'weak', confirmPassword: 'weak' } }, res);
    expect(res.status.calledWith(400)).to.equal(true);
    expect(find.called).to.equal(false);
  });
});
