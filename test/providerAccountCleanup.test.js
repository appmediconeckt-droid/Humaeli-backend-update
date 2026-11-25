import { expect } from 'chai';
import sinon from 'sinon';
import { cleanupAccountData } from '../src/services/accountCleanupService.js';
import Appointment from '../src/models/appointmentModel.js';
import WalkinAppointment from '../src/models/walkinAppointmentModel.js';
import Prescription from '../src/models/Prescription.js';
import { FollowUp, Medication } from '../src/models/clinicModels.js';
import AppointmentPayment from '../src/models/appointmentPaymentModel.js';
import Transaction from '../src/models/transactionModel.js';
import CounselorEarning from '../src/models/CounselorEarning.js';
import CounselorOnlineSubscription from '../src/models/CounselorOnlineSubscription.js';
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

describe('Provider account cleanup', () => {
  const id = '65a000000000000000000001';
  const models = [Appointment, WalkinAppointment, Prescription, FollowUp, Medication, AppointmentPayment, Transaction, CounselorEarning, CounselorOnlineSubscription, Call, Chat, ChatSession, Conversation, Message, Notification, OTP, LoginOTP, Rating, RatingStatus, Session, AIChat];
  beforeEach(() => {
    models.forEach(model => sinon.stub(model, 'deleteMany').resolves({ acknowledged: true, deletedCount: 1 }));
    sinon.stub(Chat, 'find').returns({ select: async () => [] });
  });
  afterEach(() => sinon.restore());
  for (const role of ['doctor', 'counsellor']) {
    it(`removes ${role} appointments and related records without deleting other providers' records`, async () => {
      const result = await cleanupAccountData({ userId: id, role });
      expect(String(WalkinAppointment.deleteMany.firstCall.args[0].doctor_id)).to.equal(id);
      expect(String(Prescription.deleteMany.firstCall.args[0].psychiatristId)).to.equal(id);
      expect(String(FollowUp.deleteMany.firstCall.args[0].doctor_id)).to.equal(id);
      expect(String(AppointmentPayment.deleteMany.firstCall.args[0].providerId)).to.equal(id);
      expect(String(Appointment.deleteMany.firstCall.args[0].$or[1].counselor)).to.equal(id);
      expect(result.paymentHistoryPreserved).to.equal(false);
    });
  }
  it('does not delete provider records when a patient account is deleted', async () => {
    await cleanupAccountData({ userId: id, role: 'user' });
    expect(WalkinAppointment.deleteMany.called).to.equal(false);
    expect(Prescription.deleteMany.called).to.equal(false);
    expect(AppointmentPayment.deleteMany.called).to.equal(false);
  });
});
