const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(relative, context) {
  const source = fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, context);
}
function fixture(user = {}) {
  const queries = { clinics: [], online: [], walkins: [], prescriptions: [] };
  const chain = rows => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, lean: async () => rows });
  const account = { role: 'receptionist', isActive: true, assignedDoctor: 'doctor-a', clinic_id: 'clinic-a', ...user };
  const context = vm.createContext({
    console,
    User: { findById: () => ({ select: async () => account }), findOne: () => ({ select: async () => ({ fullName: 'Doctor A' }) }) },
    Clinic: { find: filter => { queries.clinics.push(filter); return Promise.resolve([{ _id: 'clinic-a', clinic_name: 'Assigned clinic' }]); } },
    Appointment: { find: filter => { queries.online.push(filter); return chain([]); } },
    WalkinAppointment: { find: filter => { queries.walkins.push(filter); return chain([]); } },
    Prescription: { find: filter => { queries.prescriptions.push(filter); return chain([]); } },
    normalizeQueueAppointment: row => row,
    isActiveQueueAppointment: () => false, isServingQueueAppointment: () => false,
    getDisplayTiming: async () => null,
  });
  load('utils/clinicAccess.js', context);
  return { context, queries };
}

for (const [file, handler] of [
  ['receptionistController.js', 'receptionistDashboard'],
  ['staffAppointmentsController.js', 'staffAppointments'],
  ['staffPatientHistoryController.js', 'staffPatientHistory'],
]) {
  test(`${handler} scopes omitted clinic filters to the receptionist assignment`, async () => {
    const { context, queries } = fixture();
    load(`controllers/${file}`, context);
    let body;
    const response = { set() {}, status() { return this; }, json(value) { body = value; } };
    await vm.runInContext(handler, context)({ userId: 'staff-a', query: {} }, response);
    assert.equal(body.success, true);
    assert.equal(queries.clinics[0]._id, 'clinic-a');
    assert.equal(queries.clinics[0].doctor_id, 'doctor-a');
    assert.equal(queries.online[0].clinic_id, 'clinic-a');
    assert.equal(queries.walkins[0].clinic_id, 'clinic-a');
    assert.equal(queries.prescriptions.length, 0);
    assert.equal(body.clinics.length, 1);
  });
  for (const [name, account, query] of [
    ['another clinic', {}, { clinic_id: 'clinic-b' }],
    ['missing assignment', { clinic_id: null }, {}],
    ['another doctor', {}, { doctor_id: 'doctor-b' }],
  ]) {
    test(`${handler} rejects ${name} before reading patient data`, async () => {
      const { context, queries } = fixture(account);
      load(`controllers/${file}`, context);
      let status;
      const response = { status(value) { status = value; return this; }, json() {}, set() {} };
      await vm.runInContext(handler, context)({ userId: 'staff-a', query }, response);
      assert.equal(status, 403);
      assert.equal(queries.online.length, 0);
      assert.equal(queries.walkins.length, 0);
      assert.equal(queries.clinics.length, 0);
    });
  }
}
test('doctor and other staff clinic selection remains available', async () => {
  for (const role of ['doctor', 'nurse']) {
    const { context } = fixture({ role });
    const scope = vm.runInContext('receptionistClinicScope', context);
    assert.equal(await scope({ userId: 'staff-a' }), '');
    assert.equal(await scope({ userId: 'staff-a' }, 'clinic-b'), 'clinic-b');
  }
});

test('LED clinic list contains only the assigned clinic', async () => {
  const { context } = fixture();
  let route, body;
  context.router = { get(_path, _protect, handler) { route = handler; } };
  context.protect = () => {};
  context.doctorClinics = async () => [
    { clinicId: 'clinic-a', doctorClinicId: 'display-a' },
    { clinicId: 'clinic-b', doctorClinicId: 'display-b' },
  ];
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/clinicQrRoutes.js'), 'utf8');
  const start = source.indexOf("router.get('/doctors/:doctorId/clinics'");
  const end = source.indexOf("router.get('/walkin/:doctorClinicId/queue'", start);
  vm.runInContext(source.slice(start, end), context);
  await route({ userId: 'staff-a', params: { doctorId: 'doctor-a' } }, { json(value) { body = value; } });
  assert.equal(body.data.clinics.length, 1);
  assert.equal(body.data.clinics[0].doctorClinicId, 'display-a');
});
