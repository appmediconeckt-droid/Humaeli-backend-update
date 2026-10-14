import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import Appointment from '../src/models/appointmentModel.js';
import { filterPatientDirectory } from '../src/services/patientDirectoryService.js';
import { getAppointments } from '../src/controllers/appointmentController.js';

describe('Deleted patients in the doctor directory', () => {
  afterEach(() => sinon.restore());
  it('excludes missing and inactive populated patients', async () => {
    const active = { patient: { _id: 'active', fullName: 'Active patient', isActive: true } };
    expect(await filterPatientDirectory([active, { patient: null }, { patient: { isActive: false } }], 'online')).to.deep.equal([active]);
  });
  it('checks legacy unresolved online references instead of trusting snapshots', async () => {
    sinon.stub(User, 'find').returns({ select: () => ({ lean: async () => [{ _id: 'active' }] }) });
    const active = { patient: 'active' };
    expect(await filterPatientDirectory([active, { patient: 'deleted', patient_name: 'Old name' }], 'online')).to.deep.equal([active]);
  });
  it('preserves unregistered walk-ins but removes walk-ins linked to deleted accounts', async () => {
    const find = sinon.stub(User, 'find').returns({ select: () => ({ lean: async () => [{ _id: 'active' }] }) });
    const visitor = { patient_id: null, patient_name: 'Walk-in visitor' }, active = { patient_id: 'active' };
    expect(await filterPatientDirectory([visitor, active, { patient_id: 'deleted', patient_name: 'Old snapshot' }], 'walkin')).to.deep.equal([visitor, active]);
    expect(find.firstCall.args[0]._id.$in).to.deep.equal(['active', 'deleted']);
  });
  it('filters only directory requests and leaves archived appointments available elsewhere', async () => {
    const rows = [{ _id: 'orphan', patient: null }, { _id: 'active', patient: { _id: 'patient', fullName: 'Active patient', isActive: true } }];
    const chain = { populate() { return this; }, sort() { return this; }, lean: async () => rows };
    sinon.stub(Appointment, 'find').returns(chain);
    const res = { json: sinon.spy(), set: sinon.spy(), status: sinon.stub().returnsThis() };
    await getAppointments({ user: { _id: 'doctor', role: 'doctor' }, query: { doctor_id: 'doctor', patient_directory: 'true' } }, res);
    expect(res.json.firstCall.args[0].map(row => row._id)).to.deep.equal(['active']);
    const history = { json: sinon.spy(), status: sinon.stub().returnsThis() };
    await getAppointments({ user: { _id: 'doctor', role: 'doctor' }, query: { doctor_id: 'doctor' } }, history);
    expect(history.json.firstCall.args[0]).to.have.length(2);
  });
});
