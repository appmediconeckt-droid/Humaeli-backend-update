import { expect } from "chai";
import sinon from "sinon";
import { getPool } from "../src/config/mysql.js";
import { getMyChatHistory, deleteMyChatMessage } from "../src/controllers/chatController.js";

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

describe("AI chat MySQL persistence", () => {
  let sandbox, query, execute;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    query = sandbox.stub(getPool(), "query");
    execute = sandbox.stub(getPool(), "execute");
  });
  afterEach(() => sandbox.restore());

  it("returns empty history without a MongoDB connection", async () => {
    query.resolves([[]]);
    const res = response();
    await getMyChatHistory({ user: { id: "patient-123456" } }, res);
    expect(res.statusCode).to.equal(200);
    expect(res.body).to.deep.equal({ success: true, sessionId: null, history: [] });
    expect(query.firstCall.args[0]).to.include("FROM `aichats`");
    expect(query.firstCall.args[1]).to.deep.equal(["patient-123456"]);
  });

  it("loads only the user's latest session and preserves message IDs", async () => {
    query.onFirstCall().resolves([[{ sessionId: "session-latest" }]]);
    query.onSecondCall().resolves([[{
      id: "chat-123456789", userMessage: "Hello", aiResponse: "Hi",
      createdAt: new Date("2026-09-25T00:00:00Z"),
    }]]);
    const res = response();
    await getMyChatHistory({ user: { id: "patient-123456" } }, res);
    expect(res.statusCode).to.equal(200);
    expect(res.body.sessionId).to.equal("session-latest");
    expect(res.body.history.map(({ role, content, chatId }) => ({ role, content, chatId }))).to.deep.equal([
      { role: "user", content: "Hello", chatId: "chat-123456789" },
      { role: "assistant", content: "Hi", chatId: "chat-123456789" },
    ]);
    expect(query.secondCall.args[1]).to.deep.equal(["patient-123456", "session-latest"]);
    expect(query.secondCall.args[0]).to.include("ORDER BY `createdAt` ASC LIMIT 100");
  });

  it("deletes a caller-owned turn with the MySQL promise API", async () => {
    query.resolves([[{ id: "chat-123456789", sessionId: "session-latest" }]]);
    execute.resolves([{ affectedRows: 1 }]);
    const res = response();
    await deleteMyChatMessage({ user: { id: "patient-123456" }, params: { chatId: "chat-123456789" } }, res);
    expect(res.statusCode).to.equal(200);
    expect(res.body.deletedChatId).to.equal("chat-123456789");
    expect(execute.firstCall.args[1]).to.deep.equal(["chat-123456789", "patient-123456"]);
  });

  it("does not delete another user's turn", async () => {
    query.resolves([[]]);
    const res = response();
    await deleteMyChatMessage({ user: { id: "patient-123456" }, params: { chatId: "chat-123456789" } }, res);
    expect(res.statusCode).to.equal(404);
    expect(execute.called).to.equal(false);
  });
});
