import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import User from "../src/models/userModel.js";
import AdminUser from "../src/admin/models/User.js";
import Transaction from "../src/admin/models/Transaction.js";
import Earning from "../src/admin/models/CounselorEarning.js";
import Notification from "../src/admin/models/Notification.js";
import authRoutes from "../src/admin/routes/simpleAuthRoutes.js";
import { changePassword } from "../src/admin/controllers/simpleAuthController.js";
import { sendPromotionNotificationToMainBackend as sendPromotion } from "../src/admin/services/mainBackendNotificationClient.js";
import { matchRuleRecipients } from "../src/admin/services/notificationRecipientMatcher.js";
import { sendWalletRefundStatusNotification } from "../src/services/walletRefundNotificationService.js";

const id = "507f1f77bcf86cd799439011";
describe("merged admin integration", () => {
  let sandbox;
  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => sandbox.restore());

  it("shares User and preserves refund idempotency fields", () => {
    expect(AdminUser).to.equal(User);
    expect(new User({ walletAdjustmentIds: ["adjustment"] }).walletAdjustmentIds).to.deep.equal(["adjustment"]);
    expect(new Transaction({ transactionId: "adjustment" }).transactionId).to.equal("adjustment");
    expect(Transaction.schema.indexes().some(([keys, options]) => keys.transactionId === 1 && options.unique && options.sparse)).to.equal(true);
    expect(new Earning({ metadata: { adjustmentId: "adjustment" } }).metadata.adjustmentId).to.equal("adjustment");
  });

  it("rejects missing credentials and throttles repeated login attempts", async () => {
    const app = express(); app.use(express.json()); app.use("/auth", authRoutes);
    for (let i = 0; i < 5; i++) await request(app).post("/auth/login").send({}).expect(400);
    await request(app).post("/auth/login").send({}).expect(429);
    await request(app).get("/auth/profile").expect(401);
  });

  it("protects all admin resource routers", async () => {
    for (const name of ["user", "counselor", "dashboard", "revenue", "payout", "location", "settings", "notification", "review", "payment", "support", "refund"]) {
      const { default: routes } = await import(`../src/admin/routes/${name}Routes.js`);
      const app = express(); app.use("/", routes);
      // Inspect each router's first GET contract because some expose /overview or /rules.
      const first = routes.stack.find(layer => layer.route?.methods.get);
      expect(first, name).to.exist;
      await request(app).get(first.route.path.replace(/:[^/]+/g, id)).expect(401);
    }
  });

  it("writes password to project root and preserves literal bcrypt hash", async () => {
    sandbox.stub(bcrypt, "compare").resolves(true);
    sandbox.stub(bcrypt, "hash").resolves("$2b$10$literal");
    sandbox.stub(fs, "readFileSync").returns("ADMIN_PASSWORD_HASH=old\n");
    const write = sandbox.stub(fs, "writeFileSync");
    const prior = process.env.ADMIN_PASSWORD_HASH;
    const priorPath = process.env.DOTENV_PATH;
    delete process.env.DOTENV_PATH;
    try {
      const res = { json: sandbox.spy(), status() { return this; } };
      await changePassword({ body: { currentPassword: "old", newPassword: "password123", confirmPassword: "password123" } }, res);
      expect(write.firstCall.args[0]).to.equal(path.resolve(".env"));
      expect(write.firstCall.args[1]).to.equal("ADMIN_PASSWORD_HASH=$2b$10$literal\n");
    } finally {
      if (prior === undefined) delete process.env.ADMIN_PASSWORD_HASH; else process.env.ADMIN_PASSWORD_HASH = prior;
      if (priorPath === undefined) delete process.env.DOTENV_PATH; else process.env.DOTENV_PATH = priorPath;
    }
  });

  it("delivers selected promotions locally and filters recipients by role", async () => {
    const find = sandbox.stub(User, "find").returns({ select() { return this; }, lean() { return this; }, async *cursor() { yield { _id: id }; } });
    sandbox.stub(User, "findById").returns({ select() { return this; }, lean: async () => ({ role: "user" }) });
    const create = sandbox.stub(Notification, "create").callsFake(async data => ({ toObject: () => data }));
    const network = sandbox.stub(globalThis, "fetch").rejects(new Error("No network allowed"));
    const result = await sendPromotion({ audience: "selected_users", selectedUserIds: [id], title: "Hello", body: "News" });
    expect(result.success).to.equal(true);
    expect(result.body.deliveredCount).to.equal(1);
    expect(find.firstCall.args[0]).to.deep.equal({ isActive: true, role: "user", _id: { $in: [id] } });
    expect(create.firstCall.args[0]).to.include({ recipientId: id, type: "system", message: "News" });
    expect(network.called).to.equal(false);
  });

  it("rejects empty selected audience before querying the database", async () => {
    const find = sandbox.stub(User, "find");
    expect((await sendPromotion({ audience: "selected_users", selectedUserIds: [] })).status).to.equal(400);
    expect(find.called).to.equal(false);
  });

  it("uses chatbot lastSeen for inactivity rules", async () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const find = sandbox.stub(User, "find").returns({ select() { return this; }, lean: async () => [{ _id: id, role: "user", lastSeen: new Date("2026-09-08T00:00:00Z"), fcmToken: "token" }] });
    const result = await matchRuleRecipients({ condition: "inactive_2_days", audience: "all_users" }, now);
    expect(find.firstCall.args[0].lastSeen.$lte).to.deep.equal(new Date("2026-09-09T00:00:00Z"));
    expect(result.matchedRecipients[0].inactivityAgeDays).to.equal(3);
  });

  it("does not notify a mismatched refund status", async () => {
    sandbox.stub(Transaction, "findOne").returns({ lean: async () => null });
    const create = sandbox.stub(Notification, "create");
    expect((await sendWalletRefundStatusNotification(id, "paid")).success).to.equal(false);
    expect(create.called).to.equal(false);
  });
});
