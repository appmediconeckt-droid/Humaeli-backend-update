import assert from 'node:assert/strict';
import { publishDisplayQueueChange, subscribeDisplayQueue } from '../src/services/displayQueueEvents.js';
import { emitAppointmentUpdated } from '../src/services/portalRealtimeService.js';

describe('Event-driven LED queues', () => {
  it('refreshes only the affected doctor and removes listeners on disconnect', () => {
    let first = 0;
    let second = 0;
    const stopFirst = subscribeDisplayQueue({ doctorId: 'one', facilityId: 'clinic' }, () => first++);
    const stopSecond = subscribeDisplayQueue({ doctorId: 'two', facilityId: 'clinic' }, () => second++);
    try {
      publishDisplayQueueChange({ doctorId: 'one', facilityId: 'clinic' });
      assert.equal(first, 1);
      assert.equal(second, 0);
      stopFirst();
      publishDisplayQueueChange({ doctorId: 'one' });
      assert.equal(first, 1);
    } finally { stopFirst(); stopSecond(); }
  });

  it('invalidates the LED on appointment completion even without an authenticated socket', () => {
    let changes = 0;
    const stop = subscribeDisplayQueue({ doctorId: 'doctor' }, () => changes++);
    try {
      emitAppointmentUpdated({ counselor: { _id: 'doctor' }, status: 'completed' });
      assert.equal(changes, 1);
      emitAppointmentUpdated({ doctor_id: 'doctor', appointment_status: 'completed' });
      assert.equal(changes, 2);
      emitAppointmentUpdated({ doctor_id: 'doctor' }, { displayChanged: false });
      assert.equal(changes, 2, 'background timing broadcasts must not refresh the LED queue');
    } finally { stop(); }
  });

  it('also updates facility displays for doctors in the validated roster', () => {
    let changes = 0;
    const stop = subscribeDisplayQueue({ facilityId: 'clinic', doctorIds: ['one', 'two'] }, () => changes++);
    try {
      publishDisplayQueueChange({ doctorId: 'one' });
      publishDisplayQueueChange({ doctorId: 'unrelated' });
      publishDisplayQueueChange({ facilityId: 'clinic' });
      assert.equal(changes, 2);
    } finally { stop(); }
  });
});
