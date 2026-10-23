import { expect } from 'chai';
import { emitResourceUpdated, emitAppointmentUpdated, emitPrescriptionUpdated, emitChatUpdated } from '../src/services/portalRealtimeService.js';

describe('Portal real-time invalidation', () => {
  let previousIo, events, broadcasts;
  beforeEach(() => {
    previousIo = global.io;
    events = []; broadcasts = [];
    global.io = {
      to: (room) => ({ emit: (event, payload) => events.push({ room, event, payload }) }),
      emit: (event, payload) => broadcasts.push({ event, payload }),
    };
  });
  afterEach(() => { global.io = previousIo; });

  it('sends one invalidation per affected account and never includes record contents', () => {
    emitResourceUpdated('wallet', ['patient', { _id: 'patient' }, null, 'counselor']);
    expect(events.map(({ room }) => room)).to.deep.equal(['user_patient', 'user_counselor']);
    expect(events.every(({ event }) => event === 'wallet:updated')).to.equal(true);
    expect(Object.keys(events[0].payload).sort()).to.deep.equal(['resource', 'updatedAt']);
    expect(broadcasts).to.have.length(0);
  });

  it('updates both parties after appointments, prescriptions and chat status changes', () => {
    emitAppointmentUpdated({ patient: { _id: 'patient' }, counselor: 'doctor', symptoms: 'private' });
    expect(events.map(({ room }) => room)).to.deep.equal(['user_patient', 'user_doctor']);
    expect(broadcasts).to.deep.equal([{ event: 'availability:updated', payload: { doctorId: 'doctor' } }]);
    events.length = 0;
    emitPrescriptionUpdated({ patientId: 'patient', psychiatristId: 'doctor', medicines: ['private'] });
    expect(events.map(({ event }) => event)).to.deep.equal(['prescriptions:updated', 'prescriptions:updated']);
    events.length = 0;
    emitChatUpdated({ userId: 'patient', counselorId: 'doctor', message: 'private' });
    expect(events.map(({ event }) => event)).to.deep.equal(['chats:updated', 'chats:updated']);
    expect(JSON.stringify(events)).not.to.include('private');
  });

  it('normalizes database ObjectIds and does not require a connected socket server', () => {
    emitResourceUpdated('profile', [{ toHexString: () => 'abc123', id: Buffer.from('binary') }]);
    expect(events[0].room).to.equal('user_abc123');
    global.io = null;
    expect(() => emitAppointmentUpdated({ patient: 'patient', counselor: 'doctor' })).not.to.throw();
  });
});
