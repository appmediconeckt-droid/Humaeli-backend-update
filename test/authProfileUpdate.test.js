import { expect } from "chai";
import sinon from "sinon";
import { updateUserById } from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";

describe("Counsellor profile update certification validation", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  for (const [input, expected] of [['Male', 'male'], [' FEMALE ', 'female'], ['Other', 'other']]) {
    it(`normalizes ${input} before persisting a profile update`, async () => {
      sandbox.stub(User, 'findById').resolves({ _id: 'user123', role: 'user' });
      const update = sandbox.stub(User, 'findByIdAndUpdate').returns({ select: async () => ({ _id: 'user123', role: 'user', gender: expected }) });
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await updateUserById({ params: { userId: 'user123' }, body: { gender: input }, files: {} }, res);
      expect(res.status.calledWith(200)).to.equal(true);
      expect(update.firstCall.args[1].$set.gender).to.equal(expected);
      const document = new User({ fullName: 'Test', email: 'test@example.test', password: 'test', phoneNumber: '9876543210', gender: input });
      await document.validate();
      expect(document.gender).to.equal(expected);
    });
  }

  it('rejects invalid gender with 400 before accessing storage', async () => {
    const find = sandbox.stub(User, 'findById');
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await updateUserById({ params: { userId: 'user123' }, body: { gender: 'invalid' } }, res);
    expect(res.status.calledWith(400)).to.equal(true);
    expect(res.json.firstCall.args[0].field).to.equal('gender');
    expect(find.called).to.equal(false);
  });

  it('returns 400 for model validation errors instead of 500', async () => {
    sandbox.stub(User, 'findById').resolves({ _id: 'user123', role: 'user' });
    const error = Object.assign(new Error('Invalid field'), { name: 'ValidationError', errors: { gender: {} } });
    sandbox.stub(User, 'findByIdAndUpdate').returns({ select: async () => { throw error; } });
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await updateUserById({ params: { userId: 'user123' }, body: { gender: 'male' }, files: {} }, res);
    expect(res.status.calledWith(400)).to.equal(true);
    expect(res.json.firstCall.args[0].fields).to.deep.equal(['gender']);
  });

  it('rejects object-shaped primitive profile fields before coercion', async () => {
    const objectWithoutPrimitive = Object.create(null);
    objectWithoutPrimitive.value = 'Test User';
    const find = sandbox.stub(User, 'findById').resolves({ _id: 'user123', role: 'user' });
    const update = sandbox.stub(User, 'findByIdAndUpdate');
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };

    await updateUserById({ params: { userId: 'user123' }, body: { fullName: objectWithoutPrimitive }, files: {} }, res);

    expect(res.status.calledWith(400)).to.equal(true);
    expect(res.json.firstCall.args[0]).to.include({ success: false, field: 'fullName' });
    expect(find.calledOnce).to.equal(true);
    expect(update.called).to.equal(false);
  });

  it('normalizes parser-shaped counselor array fields', async () => {
    const currentUser = {
      _id: 'user123',
      role: 'counsellor',
      certifications: [],
    };
    sandbox.stub(User, 'findById').resolves(currentUser);
    const findByIdAndUpdateStub = sandbox.stub(User, 'findByIdAndUpdate').returns({
      select: sinon.stub().resolves({ ...currentUser, specialization: ['Stress'], languages: ['English'] }),
    });
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };

    await updateUserById({
      params: { userId: 'user123' },
      body: {
        specialization: { 0: 'Stress', 1: ' Anxiety ' },
        languages: { 0: 'English' },
        consultationMode: '["video","chat"]',
      },
      files: {},
    }, res);

    expect(res.status.calledWith(200)).to.equal(true);
    expect(findByIdAndUpdateStub.firstCall.args[1].$set.specialization).to.deep.equal(['Stress', 'Anxiety']);
    expect(findByIdAndUpdateStub.firstCall.args[1].$set.languages).to.deep.equal(['English']);
    expect(findByIdAndUpdateStub.firstCall.args[1].$set.consultationMode).to.deep.equal(['video', 'chat']);
  });

  it("rejects profile updates when more than five certification documents are submitted", async function () {
    const currentUser = {
      _id: "user123",
      role: "counsellor",
      certifications: [],
    };

    sandbox.stub(User, "findById").resolves(currentUser);
    const findByIdAndUpdateStub = sandbox.stub(User, "findByIdAndUpdate").returns({
      select: sinon.stub().resolves({}),
    });

    const req = {
      params: { userId: "user123" },
      body: {
        fullName: "Test Counselor",
        certifications: Array.from({ length: 6 }, (_, index) => ({
          name: `Document ${index + 1}`,
        })),
      },
      files: {},
    };
    const res = {
      status: sinon.stub().returnsThis(),
      json: sinon.spy(),
    };

    await updateUserById(req, res);

    expect(res.status.calledWith(400)).to.equal(true);
    expect(res.json.calledWithMatch(sinon.match.has("message", sinon.match(/maximum of 5/i)))).to.equal(true);
    expect(findByIdAndUpdateStub.notCalled).to.equal(true);
  });

  it("rejects profile updates when a new certification has no uploaded document image", async function () {
    const currentUser = {
      _id: "user123",
      role: "counsellor",
      certifications: [],
    };

    sandbox.stub(User, "findById").resolves(currentUser);
    const findByIdAndUpdateStub = sandbox.stub(User, "findByIdAndUpdate").returns({
      select: sinon.stub().resolves({}),
    });

    const req = {
      params: { userId: "user123" },
      body: {
        fullName: "Test Counselor",
        certifications: [
          {
            name: "Certificate A",
            documentUrl: "",
          },
        ],
      },
      files: {},
    };
    const res = {
      status: sinon.stub().returnsThis(),
      json: sinon.spy(),
    };

    await updateUserById(req, res);

    expect(res.status.calledWith(400)).to.equal(true);
    expect(res.json.calledWithMatch(sinon.match.has("message", sinon.match(/upload.*document/i)))).to.equal(true);
    expect(findByIdAndUpdateStub.notCalled).to.equal(true);
  });

  it("accepts profile phone updates using the submitted country code", async function () {
    const currentUser = {
      _id: "user123",
      role: "user",
      phoneNumber: "9876543210",
      phoneCountryCode: "+91",
    };
    const updatedUser = {
      _id: "user123",
      role: "user",
      fullName: "Test User",
      email: "test@example.com",
      phoneNumber: "56555555455",
      phoneCountryCode: "+86",
    };

    sandbox.stub(User, "findById").resolves(currentUser);
    sandbox.stub(User, "findOne").returns({
      select: sinon.stub().returns({
        lean: sinon.stub().resolves(null),
      }),
    });
    const findByIdAndUpdateStub = sandbox.stub(User, "findByIdAndUpdate").returns({
      select: sinon.stub().resolves(updatedUser),
    });

    const req = {
      params: { userId: "user123" },
      body: {
        phoneNumber: "56555555455",
        phoneCountryCode: "+86",
      },
      files: {},
    };
    const res = {
      status: sinon.stub().returnsThis(),
      json: sinon.spy(),
    };

    await updateUserById(req, res);

    expect(res.status.calledWith(200)).to.equal(true);
    expect(findByIdAndUpdateStub.calledOnce).to.equal(true);
    expect(findByIdAndUpdateStub.firstCall.args[1].$set).to.include({
      phoneNumber: "56555555455",
      phoneCountryCode: "+86",
    });
    expect(res.json.calledWithMatch({ success: true })).to.equal(true);
  });
});
