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
    await getAppointments({ user: { _id: "doctor" }, query: {} }, res);
    const fields = chain.populate.firstCall.args[1].split(" ");
    expect(chain.populate.firstCall.args[0]).to.equal("patient");
    expect(fields).to.include.members(["fullName", "phoneNumber", "dateOfBirth", "age", "gender", "bloodGroup", "address", "locationData"]);
    expect(chain.populate.secondCall.args).to.deep.equal(["counselor", "fullName profilePhoto anonymous"]);
    expect(find.firstCall.args[0].$or).to.deep.equal([{ patient: "doctor" }, { counselor: "doctor" }]);
  });
});
