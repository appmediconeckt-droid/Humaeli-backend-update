import { EventEmitter } from 'node:events';

const events = new EventEmitter();
events.setMaxListeners(0);
const id = value => String(value?._id || value?.id || value || '');

export function publishDisplayQueueChange({ doctorId, facilityId, departmentId } = {}) {
  events.emit('change', { doctorId: id(doctorId), facilityId: id(facilityId), departmentId: id(departmentId) });
}

export function subscribeDisplayQueue(scope, notify) {
  const receive = change => {
    const doctorMatches = scope.doctorId && change.doctorId === id(scope.doctorId);
    const facilityMatches = scope.facilityId && change.facilityId === id(scope.facilityId);
    // Appointment events carry a doctor ID; facility-wide displays also need
    // those events, so their validated doctor roster is captured on connection.
    const rosterMatches = scope.doctorIds?.map(id).includes(change.doctorId);
    if (scope.doctorId ? doctorMatches : facilityMatches || rosterMatches) notify();
  };
  events.on('change', receive);
  return () => events.off('change', receive);
}
