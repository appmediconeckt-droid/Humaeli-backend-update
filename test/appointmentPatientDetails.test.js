import { expect } from "chai";
import sinon from "sinon";
import { getAppointments } from "../src/controllers/appointmentController.js";
import Appointment from "../src/models/appointmentModel.js";

describe("Doctor appointment patient details", () => {
  afterEach(() => sinon.restore());
  it("returns Online as the appointment source without changing registered patient details", async () => {
    const record = { status: "completed", patient: { _id: "patient", fullName: "Registered Patient", phoneNumber: "9876543210" } };
    const chain = { populate() { return this; }, sort() { return this; }, lean: async () => [record] };
    sinon.stub(Appointment, "find").returns(chain);
    const res = { json: sinon.spy(), status() { return this; } };
    await getAppointments({ user: { _id: "doctor", role: "doctor" }, query: { doctor_id: "doctor" } }, res);
    expect(res.json.firstCall.args[0][0].appointment_type).to.equal("online");
    expect(res.json.firstCall.args[0][0].patient).to.deep.equal(record.patient);
  });
  it("includes registration phone and address in the populated patient fields", async () => {
    const chain = { populate: sinon.stub().returnsThis(), sort() { return this; }, lean: async () => [] };
    const find = sinon.stub(Appointment, "find").returns(chain);
    const res = { json: sinon.spy(), status() { return this; } };
    await getAppointments({ user: { _id: "doctor", role: "doctor" }, query: { doctor_id: "doctor" } }, res);
    const fields = chain.populate.firstCall.args[1].split(" ");
    expect(chain.populate.firstCall.args[0]).to.equal("patient");
    expect(fields).to.include.members(["fullName", "phoneNumber", "dateOfBirth", "age", "gender", "bloodGroup", "address", "locationData"]);
    const counselorFields = chain.populate.secondCall.args[1].split(" ");
    expect(chain.populate.secondCall.args[0]).to.equal("counselor");
    expect(counselorFields).to.include.members(["fullName", "profilePhoto", "anonymous", "role", "accountType", "specialization", "experience", "qualification", "rating", "consultationMode"]);
    expect(find.firstCall.args[0]).to.deep.equal({ counselor: "doctor" });
  });
});
