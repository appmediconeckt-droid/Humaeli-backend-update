const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('patient check-in preserves recorded vitals and only updates supplied measurements', async () => {
  const patient = { counselor: 'doctor', vitals: { blood_pressure: '120/80', pulse: 74, recorded_by: 'receptionist', spo2: 98 } };
  const context = vm.createContext({
    doctorScope: async () => 'doctor', handle: fn => fn,
    pick: (body, keys) => Object.fromEntries(keys.filter(key => body[key] !== undefined).map(key => [key, body[key]])),
    Appointment: { findOneAndUpdate: async (_filter, update) => {
      for (const [key, value] of Object.entries(update.$set)) {
        if (key.startsWith('vitals.')) patient.vitals[key.slice(7)] = value;
        else patient[key] = value;
      }
      return patient;
    } },
    emitQueueUpdated: () => {}, appointmentView: async row => row,
  });
  const source = readFileSync(path.join(__dirname, '../src/controllers/appointmentController.js'), 'utf8');
  const start = source.lastIndexOf('export const nurseCheckIn = handle(');
  const end = source.indexOf('const consultationFields =', start);
  vm.runInContext(source.slice(start, end).replace('export const nurseCheckIn', 'globalThis.checkIn'), context);
  const response = { json() {} };
  await context.checkIn({ params: { id: 'patient' }, body: {} }, response);
  assert.deepEqual(patient.vitals, { blood_pressure: '120/80', pulse: 74, recorded_by: 'receptionist', spo2: 98 });
  await context.checkIn({ params: { id: 'patient' }, body: { pulse: 76 } }, response);
  assert.deepEqual(patient.vitals, { blood_pressure: '120/80', pulse: 76, recorded_by: 'receptionist', spo2: 98 });
});
