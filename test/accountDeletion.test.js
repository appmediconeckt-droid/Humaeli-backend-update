import { expect } from "chai";
import sinon from "sinon";
import { deleteUser } from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import cloudinary from "../src/config/cloudinary.js";

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
describe("Self-service account deletion", () => {
  afterEach(() => sinon.restore());
  for (const photo of [null, "https://example.com/avatar.png", { url: "https://example.com/avatar.png", publicId: null }, { publicId: "profile-photos/owned" }]) {
    it(`deletes the authenticated account with photo ${JSON.stringify(photo)}`, async () => {
      sinon.stub(User, "findById").resolves({ profilePhoto: photo });
      const sessions = sinon.stub(Session, "deleteMany").resolves({});
      const remove = sinon.stub(User, "findByIdAndDelete").resolves({});
      const destroy = sinon.stub(cloudinary.uploader, "destroy").resolves({ result: "ok" });
      const res = response();
      await deleteUser({ userId: "own", body: { id: "someone-else" } }, res);
      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(remove.calledOnceWithExactly("own")).to.equal(true);
      expect(sessions.calledOnceWithExactly({ userId: "own" })).to.equal(true);
      expect(destroy.called).to.equal(Boolean(photo?.publicId));
    });
  }
  it("does not report deletion failure when Cloudinary cleanup fails", async () => {
    sinon.stub(User, "findById").resolves({ profilePhoto: { publicId: "owned" } });
    sinon.stub(Session, "deleteMany").resolves({});
    sinon.stub(User, "findByIdAndDelete").resolves({});
    sinon.stub(cloudinary.uploader, "destroy").rejects(new Error("media offline"));
    const res = response();
    await deleteUser({ user: { _id: "own" } }, res);
    expect(res.body.success).to.equal(true);
  });
  it("rejects unauthenticated deletion", async () => {
    const remove = sinon.stub(User, "findByIdAndDelete");
    const res = response();
    await deleteUser({ body: { id: "someone-else" } }, res);
    expect(res.statusCode).to.equal(401);
    expect(remove.called).to.equal(false);
  });
});
