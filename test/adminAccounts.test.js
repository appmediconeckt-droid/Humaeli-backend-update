import { expect } from "chai";
import sinon from "sinon";
import request from "supertest";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../src/models/userModel.js";
import routes from "../src/admin/routes/simpleAuthRoutes.js?adminAccountTests";

describe("admin accounts in users collection", () => {
  let sandbox, app, token, prior;
  const payload = { name: "Arun", email: "NEWADMIN@example.com", password: "testadmin123", confirmPassword: "testadmin123" };
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    prior = { ADMIN_EMAIL: process.env.ADMIN_EMAIL, ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET };
    process.env.ADMIN_EMAIL = "owner@example.com"; process.env.ADMIN_JWT_SECRET = "admin-test-secret";
    token = jwt.sign({ email: process.env.ADMIN_EMAIL }, process.env.ADMIN_JWT_SECRET);
    app = express(); app.use(express.json()); app.use("/api/admin/auth", routes);
  });
  afterEach(() => { sandbox.restore(); for (const [key,value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const endpoint = "/api/admin/auth/create-admin";
  it("requires authentication", async () => { await request(app).post(endpoint).send(payload).expect(401); });
  it("creates a hashed admin, then logs in and reads their own profile", async () => {
    sandbox.stub(User, "exists").resolves(null);
    let saved;
    sandbox.stub(User, "create").callsFake(async data => {
      saved = new User(data); await saved.validate(); return saved;
    });
    const created = await request(app).post(endpoint).set("Authorization", `Bearer ${token}`).send({ ...payload, role: "user", isActive: false, walletBalance: 1000 }).expect(201);
    expect(saved.role).to.equal("admin"); expect(saved.isActive).to.equal(true);
    expect(saved.walletBalance).to.equal(0); expect(saved.phoneNumber).to.equal(undefined);
    expect(saved.locationData.current.coordinates).to.deep.equal([0, 0]);
    expect(saved.email).to.equal("newadmin@example.com");
    expect(await bcrypt.compare(payload.password, saved.password)).to.equal(true);
    expect(created.body.admin).not.to.have.property("password");
    const find = sandbox.stub(User, "findOne").resolves(saved);
    const login = await request(app).post("/api/admin/auth/login").send({ email: payload.email, password: payload.password }).expect(200);
    expect(find.firstCall.args[0]).to.deep.equal({ email: "newadmin@example.com", role: "admin", isActive: true });
    expect(login.body.admin._id).to.equal(String(saved._id));
    const profile = await request(app).get("/api/admin/auth/profile").set("Authorization", `Bearer ${login.body.token}`).expect(200);
    expect(profile.body.admin.email).to.equal(saved.email);
    find.resolves(null);
    await request(app).get("/api/admin/auth/profile").set("Authorization", `Bearer ${login.body.token}`).expect(401);
  });
  it("rejects invalid input and mismatched confirmation without writing", async () => {
    const create = sandbox.stub(User, "create");
    for (const patch of [{ name: "" }, { email: "invalid" }, { password: "short" }, { confirmPassword: "different" }]) {
      await request(app).post(endpoint).set("Authorization", `Bearer ${token}`).send({ ...payload, ...patch }).expect(400);
    }
    expect(create.called).to.equal(false);
  });
  it("rejects existing user email and concurrent duplicate inserts", async () => {
    const exists = sandbox.stub(User, "exists").resolves({ _id: "existing" });
    const create = sandbox.stub(User, "create");
    await request(app).post(endpoint).set("Authorization", `Bearer ${token}`).send(payload).expect(409);
    expect(create.called).to.equal(false);
    exists.resolves(null); create.rejects({ code: 11000 });
    await request(app).post(endpoint).set("Authorization", `Bearer ${token}`).send(payload).expect(409);
  });
  it("changes a database admin password without changing environment credentials", async () => {
    const admin = new User({ role: "admin", fullName: "Admin", email: "db@example.com", password: await bcrypt.hash("oldpassword", 10) });
    const save = sandbox.stub(admin, "save").resolves(admin);
    sandbox.stub(User, "findOne").resolves(admin);
    const dbToken = jwt.sign({ email: admin.email, id: String(admin._id), role: "admin" }, process.env.ADMIN_JWT_SECRET);
    const oldHash = process.env.ADMIN_PASSWORD_HASH;
    await request(app).post("/api/admin/auth/change-password").set("Authorization", `Bearer ${dbToken}`).send({ currentPassword: "oldpassword", newPassword: "newpassword", confirmPassword: "newpassword" }).expect(200);
    expect(save.calledOnce).to.equal(true);
    expect(await bcrypt.compare("newpassword", admin.password)).to.equal(true);
    expect(process.env.ADMIN_PASSWORD_HASH).to.equal(oldHash);
  });
  it("keeps phone mandatory for ordinary local users", async () => {
    const user = new User({ fullName: "User", email: "user@example.com", password: "hash", role: "user" });
    expect(user.validateSync().errors).to.have.property("phoneNumber");
  });
});
