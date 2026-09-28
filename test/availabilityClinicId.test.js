import assert from 'node:assert/strict';
import sinon from 'sinon';
import controller from '../src/controllers/availabilityController.js';
import { Clinic, Availability, UnavailableDate } from '../src/models/clinicModels.js';
import User from '../src/models/userModel.js';

describe('Availability clinic ID contract', () => {
  const doctor = '6aa91e059b2c9409947d9396';
  const clinic = '507f1f77bcf86cd799439011';
  let sandbox;
  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => sandbox.restore());
  const res = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy() });
  const req = clinic_id => ({ query: { doctor_id: doctor, ...(clinic_id === undefined ? {} : { clinic_id }) }, user: { _id: doctor, role: 'doctor' } });
  for (const method of ['getAllRanges', 'getAvailableDates']) {
    it(`${method} rejects numeric clinic IDs before querying storage`, async () => {
      const find = sandbox.stub(Availability, 'find');
      const response = res();
      await controller[method](req('1'), response);
      assert.equal(response.status.firstCall.args[0], 400);
      assert.equal(response.json.firstCall.args[0].code, 'INVALID_CLINIC_ID');
      assert.equal(find.called, false);
    });
  }
  it('validates the clinic ID on create too', async () => {
    const find = sandbox.stub(Clinic, 'findById');
    const response = res();
    await controller.addDateRange({ ...req(), body: { clinic_id: '1' } }, response);
    assert.equal(response.status.firstCall.args[0], 400);
    assert.equal(find.called, false);
  });
  const prepare = () => {
    sandbox.stub(User, 'findById').returns({ select: async () => ({ _id: doctor, role: 'doctor', isActive: true }) });
    const exists = sandbox.stub(Clinic, 'exists').resolves({ _id: clinic });
    const find = sandbox.stub(Availability, 'find').returns({ sort: () => ({ lean: async () => [] }) });
    sandbox.stub(UnavailableDate, 'find').returns({ lean: async () => [] });
    return { exists, find };
  };
  it('uses the selected actual clinic ID scoped to its doctor', async () => {
    const { exists, find } = prepare(); const response = res();
    await controller.getAllRanges(req(clinic), response);
    assert.deepEqual(exists.firstCall.args[0], { _id: clinic, doctor_id: doctor });
    assert.deepEqual(find.firstCall.args[0], { clinic_id: clinic, doctor_id: doctor });
    assert.equal(response.json.firstCall.args[0].success, true);
  });
  it('rejects a clinic that does not belong to the selected doctor', async () => {
    const { exists, find } = prepare(); exists.resolves(null);
    const response = res(); await controller.getAllRanges(req(clinic), response);
    assert.equal(response.status.firstCall.args[0], 404); assert.equal(find.called, false);
  });
  it('allows clinic_id to be omitted for all ranges belonging to the doctor', async () => {
    const { find, exists } = prepare(); const response = res();
    await controller.getAllRanges(req(), response);
    assert.deepEqual(find.firstCall.args[0], { doctor_id: doctor }); assert.equal(exists.called, false);
  });
});
