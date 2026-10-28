import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Server } from 'socket.io';
import { io as client } from 'socket.io-client';
import SocketHandler from '../src/socket/socketHandler.js';
import { videoCallController } from '../src/controllers/videoCallController.js';
import User from '../src/models/userModel.js';
import Call from '../src/models/Call.js';
import Notification from '../src/models/Notification.js';
import NotificationToken from '../src/models/NotificationToken.js';
import { initiateDoctorCall } from '../../chatbot-frontend/src/Component/DoctorDashboard/doctorCallRequest.js';

describe('Doctor and patient signalling over real sockets', () => {
  for (const media of ['video', 'voice', 'audio']) {
  for (const [reverse, alreadyOnline] of [[false, false], [true, false], [true, true]]) {
  it(`${media}: ${reverse ? 'blocks patient to doctor' : 'delivers doctor call and acceptance'} (${alreadyOnline ? 'online' : 'reconnecting'})`, async () => {
    const doctor = reverse ? 'eeeeeeeeeeeeeeeeeeeeeeee' : 'cccccccccccccccccccccccc';
    const patient = reverse ? 'ffffffffffffffffffffffff' : 'dddddddddddddddddddddddd';
    const sender = reverse ? patient : doctor, receiver = reverse ? doctor : patient;
    const senderType = reverse ? 'user' : 'doctor', receiverType = reverse ? 'doctor' : 'user';
    const oldIo = global.io, oldHandler = global.socketHandler;
    let server, io, doctorSocket, patientSocket;
    try {
      // All records and push destinations are mocked; only loopback HTTP and
      // Socket.IO are real. No production account or device is contacted.
      sinon.stub(User, 'findById').resolves({ _id: doctor, fullName: 'Test', isActive: true });
      sinon.stub(User, 'findByIdAndUpdate').resolves({ isOnline: true });
      sinon.stub(videoCallController, 'getUserDetails').callsFake(async id => ({ fullName: id === doctor ? 'Doctor' : 'Patient', type: id === doctor ? 'doctor' : 'user', isActive: true }));
      sinon.stub(Call, 'create').callsFake(async data => { const call = new Call(data); await call.validate(); return call; });
      sinon.stub(Call, 'findOneAndUpdate').resolves({});
      sinon.stub(Notification, 'create').rejects(new Error('Push disabled in signalling test'));
      sinon.stub(NotificationToken, 'find').returns({ select() { return this; }, lean: async () => [] });
      sinon.stub(console, 'error');
      const app = express(); app.use(express.json());
      app.post('/initiate', (req, res) => { req.user = { _id: sender, role: senderType }; return videoCallController.initiateCall(req, res); });
      app.get('/pending/:userId', videoCallController.getPendingRequests);
      app.post('/accept/:callId', (req, res) => { req.user = { _id: receiver, role: receiverType }; return videoCallController.acceptCall(req, res); });
      server = createServer(app); io = new Server(server);
      io.use((socket, next) => { socket.userId = socket.handshake.auth.id; socket.userRole = socket.userId === doctor ? 'doctor' : 'user'; next(); });
      const handler = new SocketHandler(io);
      sinon.stub(handler, 'joinExistingChats').resolves();
      sinon.stub(handler, 'markUserOffline').resolves();
      handler.initialize(); global.io = io; global.socketHandler = handler;
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      doctorSocket = client(origin, { auth: { id: sender }, transports: ['websocket'], reconnection: false });
      await once(doctorSocket, 'connect');
      if (reverse) {
        const rejected = await fetch(`${origin}/initiate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receiverId: receiver, receiverType: alreadyOnline ? 'counsellor' : 'doctor', callType: media, socketId: doctorSocket.id }) });
        expect(rejected.status).to.equal(403);
        expect((await rejected.json()).code).to.equal('DOCTOR_CALLS_ONLY');
        expect(Call.create.called).to.equal(false);
        return;
      }
      let incomingEvent;
      if (alreadyOnline) {
        patientSocket = client(origin, { auth: { id: receiver }, transports: ['websocket'], reconnection: false });
        await once(patientSocket, 'connect');
        await patientSocket.timeout(3000).emitWithAck('call:ready');
        incomingEvent = once(patientSocket, 'incoming_call_request');
      }
      const call = await initiateDoctorCall({
        connect: async () => doctorSocket, receiverId: receiver, callType: media,
        request: async body => {
          // Also cover older patient clients that mislabeled a doctor as a counsellor.
          const response = await fetch(`${origin}/initiate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, receiverType: alreadyOnline ? 'counsellor' : receiverType }) });
          expect(response.status).to.equal(201);
          const data = await response.json(); return { ...data, data: { ...data, id: data.callId } };
        },
      });
      expect(Boolean(call.receiverOffline)).to.equal(!alreadyOnline);
      expect(call.status).to.equal('pending');
      if (incomingEvent) {
        const [event] = await incomingEvent;
        expect(event.callId).to.equal(call.id);
        expect(event.callType).to.equal(media);
      }
      // The patient opens the app after the initial request was sent.
      if (!alreadyOnline) {
        patientSocket = client(origin, { auth: { id: receiver }, transports: ['websocket'], reconnection: false });
        await once(patientSocket, 'connect');
      }
      expect((await patientSocket.timeout(3000).emitWithAck('call:ready')).ready).to.equal(true);
      const pending = await (await fetch(`${origin}/pending/${receiver}`)).json();
      expect(pending.pendingRequests.some(row => row.callId === call.id)).to.equal(true);
      expect(pending.pendingRequests.find(row => row.callId === call.id).callType).to.equal(media);
      const acceptedEvent = once(doctorSocket, 'call_accepted');
      const accepted = await (await fetch(`${origin}/accept/${call.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptorType: receiverType }) })).json();
      expect(accepted.status).to.equal('active');
      expect((await acceptedEvent)[0].callId).to.equal(call.id);
    } finally {
      doctorSocket?.disconnect(); patientSocket?.disconnect();
      if (io) await new Promise(resolve => io.close(resolve));
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      // Drain native socket close callbacks before Mocha's forced exit on Windows.
      await new Promise(resolve => setTimeout(resolve, 100));
      global.io = oldIo; global.socketHandler = oldHandler; sinon.restore();
    }
  });
  }
  }
});
