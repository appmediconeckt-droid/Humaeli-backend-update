import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import { updateLocation } from '../src/controllers/locationController.js';

describe('Location history validation', () => {
  it('validates existing profile history when the password changes', async () => {
    const user = new User({ locationData: { history: Array.from({ length: 8 }, () => ({
      event: 'profile', coordinates: [77.2, 28.6], capturedAt: new Date(),
    })) } });
    user.password = 'updated-password-hash';
    await user.validate(['locationData']);
    expect(user.locationData.history.every(entry => entry.event === 'profile')).to.equal(true);
  });

  it('continues to reject unsupported history events', async () => {
    const user = new User({ locationData: { history: [{ event: 'unsupported' }] } });
    const error = user.validateSync(['locationData']);
    expect(error.errors).to.have.property('locationData.history.0.event');
  });

  it('rejects invalid events before persisting location updates', async () => {
    const write = sinon.stub(User, 'findByIdAndUpdate');
    try {
      const res = { status: sinon.stub().returnsThis(), json: sinon.stub().returnsThis() };
      await updateLocation({ body: { latitude: 28.6, longitude: 77.2, event: 'unsupported' } }, res);
      expect(res.status.calledWith(400)).to.equal(true);
      expect(write.called).to.equal(false);
    } finally {
      write.restore();
    }
  });
});
