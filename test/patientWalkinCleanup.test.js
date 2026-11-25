import { expect } from 'chai';
import sinon from 'sinon';
import { Query } from 'mingo';
import { cleanupAccountData } from '../src/services/accountCleanupService.js';
import { getPatientWalkinAppointments } from '../src/services/patientWalkinAppointments.js';
import Appointment from '../src/models/appointmentModel.js';
import WalkinAppointment from '../src/models/walkinAppointmentModel.js';
import { FollowUp } from '../src/models/clinicModels.js';
import Call from '../src/models/Call.js';
import Chat from '../src/models/Chat.js';
import ChatSession from '../src/models/ChatSession.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import Notification from '../src/models/Notification.js';
import OTP from '../src/models/otpModel.js';
import LoginOTP from '../src/models/loginOtpModel.js';
import Rating from '../src/models/Rating.js';
import RatingStatus from '../src/models/RatingStatus.js';
import Session from '../src/models/sessionModel.js';
import AIChat from '../src/models/chatModel.js';

describe('Patient walk-in cleanup', () => {
  const oldId = '65a000000000000000000001';
  const newId = '65a000000000000000000002';
  const otherId = '65a000000000000000000003';
  const models = [Appointment, Call, Chat, ChatSession, Conversation, Message, Notification, OTP, LoginOTP, Rating, RatingStatus, Session, AIChat, FollowUp];
  afterEach(() => sinon.restore());

  it('deletes only the old account’s linked walk-ins and does not match an email to the new account', async () => {
    let rows = [
      { _id: 'old', patient_id: oldId, email: 'same@example.com' },
      { _id: 'other', patient_id: otherId, email: 'same@example.com' },
      { _id: 'guest', patient_id: null, email: 'same@example.com' },
    ];
    models.forEach(model => sinon.stub(model, 'deleteMany').resolves({ acknowledged: true, deletedCount: 0 }));
    sinon.stub(Chat, 'find').returns({ select: async () => [] });
    sinon.stub(WalkinAppointment, 'find').callsFake(filter => ({
      select() { return this; },
      lean: async () => rows.filter(row => String(row.patient_id) === String(filter.patient_id)),
    }));
    sinon.stub(WalkinAppointment, 'deleteMany').callsFake(async filter => {
      rows = rows.filter(row => String(row.patient_id) !== String(filter.patient_id));
      return { acknowledged: true, deletedCount: 1 };
    });
    await cleanupAccountData({ userId: oldId, role: 'user' });
    expect(rows.map(row => row._id)).to.deep.equal(['other', 'guest']);
    expect(await getPatientWalkinAppointments(newId)).to.deep.equal([]);
    expect(FollowUp.deleteMany.calledOnce).to.equal(true);
    expect(new Query({ patient_id: newId }).test(rows[0])).to.equal(false);
  });

  it('does not delete a doctor’s patients’ walk-ins during provider cleanup', async () => {
    models.forEach(model => sinon.stub(model, 'deleteMany').resolves({ acknowledged: true, deletedCount: 0 }));
    sinon.stub(Chat, 'find').returns({ select: async () => [] });
    const remove = sinon.stub(WalkinAppointment, 'deleteMany');
    await cleanupAccountData({ userId: oldId, role: 'doctor' });
    expect(remove.called).to.equal(false);
  });
});
