import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { fileURLToPath } from "node:url";
import clinicRoutes from "../src/routes/clinicRoutes.js";
import Clinic from "../src/models/clinicModel.js";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";

const app = express();
app.use(express.json());
app.use("/api/clinics", clinicRoutes);

describe("Clinic photo multipart uploads", () => {
  let token, storedPath;
  const cloudUrl = "https://res.cloudinary.com/test/image/upload/clinic-photos/photo.png";
  beforeEach(() => {
    storedPath = cloudUrl;
    token = jwt.sign({ userId: "doctor-test", sessionId: "session-test", role: "doctor" }, process.env.ACCESS_SECRET);
    sinon.stub(Session, "findOne").resolves({ isActive: true });
    sinon.stub(User, "findById").resolves({ _id: "doctor-test", role: "doctor", isActive: true });
    sinon.stub(Clinic, "create").callsFake(async data => ({ ...data, id: "clinic-test" }));
    sinon.stub(Clinic, "findOne").resolves({ id: "clinic-test", doctor_id: "doctor-test" });
    sinon.stub(Clinic, "findByIdAndUpdate").callsFake(async (id, update) => ({ id, ...update.$set }));
    const store = (req, file, cb) => {
      file.stream.resume();
      file.stream.on("end", () => cb(null, { path: storedPath, filename: "clinic-photos/photo", size: 5 }));
    };
    sinon.stub(CloudinaryStorage.prototype, "_handleFile").callsFake(store);
    sinon.stub(Object.getPrototypeOf(multer.diskStorage({})), "_handleFile").callsFake(store);
  });
  afterEach(() => sinon.restore());

  const upload = (method, field = "clinic_photo", contentType = "image/png") => request(app)[method](method === "post" ? "/api/clinics" : "/api/clinics/clinic-test")
    .auth(token, { type: "bearer" }).field("clinic_name", "Test Clinic")
    .attach(field, Buffer.from("photo"), { filename: "photo.png", contentType });

  for (const method of ["post", "patch", "put"]) {
    it(`${method} accepts clinic_photo and preserves the Cloudinary URL`, async () => {
      const res = await upload(method);
      expect(res.status).to.equal(method === "post" ? 201 : 200);
      expect(res.body.data.clinic_photo).to.equal(cloudUrl);
    });
  }

  it("preserves the local clinic-photos directory in the saved URL", async () => {
    storedPath = fileURLToPath(new URL("../uploads/clinic-photos/photo.png", import.meta.url));
    const res = await upload("post");
    expect(res.status).to.equal(201);
    expect(res.body.data.clinic_photo).to.equal("/uploads/clinic-photos/photo.png");
  });

  it("rejects non-image uploads with JSON instead of an HTML 500", async () => {
    const res = await upload("post", "clinic_photo", "application/pdf");
    expect(res.status).to.equal(400);
    expect(res.body.success).to.equal(false);
    expect(res.body.message).to.include("must be an image");
    expect(Clinic.create.called).to.equal(false);
  });

  it("rejects unexpected file fields with JSON", async () => {
    const res = await upload("post", "wrong_field");
    expect(res.status).to.equal(400);
    expect(res.body.success).to.equal(false);
    expect(Clinic.create.called).to.equal(false);
  });

  it("allows creating a clinic without a photo", async () => {
    const res = await request(app).post("/api/clinics").auth(token, { type: "bearer" }).send({ clinic_name: "Test Clinic" });
    expect(res.status).to.equal(201);
    expect(res.body.data.clinic_photo).to.equal(null);
  });
});
