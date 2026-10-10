import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import { getAppointments } from '../src/controllers/appointmentController.js';

describe('Existing doctor appointment API cancellation history filter', () => {
  afterEach(() => sinon.restore());
  for (const spelling of ['canceled', 'cancelled', ' Cancelled ']) {
    it(`returns the doctor-scoped cancellation history for ${spelling}`, async () => {
      const rows = [{ _id: 'a', status: 'canceled', queue_status: 'canceled' }];
      const chain = { populate() { return this; }, sort() { return this; }, lean: async () => rows };
      const find = sinon.stub(Appointment, 'find').returns(chain);
      const res = { json: sinon.spy(), status() { return this; } };
      await getAppointments({ user: { _id: 'doctor', role: 'doctor' }, query: { doctor_id: 'doctor', appointment_status: spelling } }, res);
      expect(find.firstCall.args[0]).to.deep.equal({ counselor: 'doctor', status: { $in: ['canceled', 'cancelled'] } });
      expect(res.json.firstCall.args[0][0].status).to.equal('canceled');
    });
  }
  it('retains unfiltered All behavior and filters completed history separately', async () => {
    const chain = { populate() { return this; }, sort() { return this; }, lean: async () => [] };
    const find = sinon.stub(Appointment, 'find').returns(chain);
    const res = { json: sinon.spy(), status() { return this; } };
    for (const appointment_status of ['All', 'completed']) {
      await getAppointments({ user: { _id: 'doctor', role: 'doctor' }, query: { appointment_status } }, res);
    }
    expect(find.firstCall.args[0]).to.deep.equal({ counselor: 'doctor' });
    expect(find.secondCall.args[0]).to.deep.equal({ counselor: 'doctor', status: 'completed' });
  });
});
