import { expect } from "chai";
import sinon from "sinon";
import { getChats, getChatMessages } from "../src/controllers/messageController.js";
import { getAppointments } from "../src/controllers/appointmentController.js";
import Chat from "../src/models/Chat.js";
import Message from "../src/models/Message.js";
import Appointment from "../src/models/appointmentModel.js";
import { getUserPhotoUrl } from "../src/utils/anonymousUser.js";

const photo = "https://api.dicebear.com/7.x/avataaars/png?seed=patient";
const patient = { _id: "patient-1", anonymous: "Boss", profilePhoto: { url: photo } };
const response = () => ({ json: sinon.spy(), status() { return this; } });

describe("Counselor patient profile images", () => {
  afterEach(() => sinon.restore());

  it("reads stored objects, JSON and URL strings, preferring the saved profile image", () => {
    for (const profilePhoto of [{ url: photo }, JSON.stringify({ url: photo }), photo]) {
      expect(getUserPhotoUrl({ profilePhoto, avatar: { url: "old.png" } })).to.equal(photo);
    }
    expect(getUserPhotoUrl({ profilePhoto: {}, avatar: { url: photo } })).to.equal(photo);
    expect(getUserPhotoUrl({})).to.equal(null);
  });

  it("keeps the saved avatar in the accepted chat messages response sent to a counselor", async () => {
    const chat = { _id: "chat-1", chatId: "chat_public_1", status: "accepted",
      userId: patient._id, counselorId: "provider-1" };
    sinon.stub(Chat, "findOne").resolves(chat);
    const chain = { populate: sinon.stub().returnsThis(),
      lean: async () => ({ ...chat, userId: patient, counselorId: { _id: "provider-1" } }) };
    sinon.stub(Chat, "findById").returns(chain);
    sinon.stub(Message, "find").returns({ sort: async () => [] });
    sinon.stub(Message, "updateMany").resolves({ modifiedCount: 0 });
    const res = response();
    await getChatMessages({ params: { chatId: chat.chatId },
      user: { _id: "provider-1", role: "counsellor" } }, res);
    const body = res.json.firstCall.args[0];
    expect(body.chatStatus).to.equal("accepted");
    expect(body.chat.user.profilePhoto).to.deep.equal({ url: photo });
    expect(body.chat.user.avatarUrl).to.equal(photo);
    expect(body.chat.user.fullName).to.equal("");
    expect(body.chat.user.email).to.equal("");
  });

  for (const role of ["counsellor", "doctor"]) {
    it(`includes the user's saved photo in the ${role} chat response`, async () => {
      const rows = [{ _id: "chat-1", chatId: "chat-1", userId: patient,
        counselorId: { _id: "provider-1" }, status: "accepted" }];
      const chain = { populate: sinon.stub().returnsThis(), sort: async () => rows };
      sinon.stub(Chat, "find").returns(chain);
      sinon.stub(Message, "findOne").returns({ sort: async () => null });
      sinon.stub(Message, "countDocuments").resolves(0);
      const res = response();
      await getChats({ user: { _id: "provider-1", role } }, res);
      expect(chain.populate.firstCall.args[1]).to.include("profilePhoto");
      expect(res.json.firstCall.args[0].chats[0].otherParty).to.include({
        name: "Boss", profilePhoto: photo, avatar: photo, avatarUrl: photo,
      });
    });

    it(`includes the user's saved photo in the ${role} appointment response`, async () => {
      sinon.stub(Appointment, "deleteMany").resolves({ deletedCount: 0 });
      const chain = { populate: sinon.stub().returnsThis(), sort() { return this; },
        lean: async () => [{ _id: "appointment-1", patient }] };
      sinon.stub(Appointment, "find").returns(chain);
      const res = response();
      await getAppointments({ user: { _id: "provider-1", role }, query: {} }, res);
      expect(chain.populate.firstCall.args[1]).to.include("profilePhoto");
      expect(res.json.firstCall.args[0][0].patient.profilePhoto.url).to.equal(photo);
      expect(res.json.firstCall.args[0][0].patient.name).to.equal("Boss");
    });
  }
});
