import { expect } from "chai";
import sinon from "sinon";
import { getAppointments } from "../src/controllers/appointmentController.js";
import Appointment from "../src/models/appointmentModel.js";

describe("Doctor appointment patient details", () => {
  afterEach(() => sinon.restore());
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
    expect(find.secondCall.args[0]).to.deep.equal({ counselor: "doctor" });
  });
});
