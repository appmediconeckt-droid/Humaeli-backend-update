import { expect } from "chai";
import sinon from "sinon";
import nodemailer from "nodemailer";

const ENV_KEYS = [
  "BREVO_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "EMAIL_FROM",
  "EMAIL_PROVIDER",
  "HUMAELI_EMAIL_FROM",
  "VERIFIED_EMAIL_FROM",
  "BREVO_FROM_EMAIL",
  "HUMAELI_BREVO_FROM_EMAIL",
  "EMAIL_USER",
  "EMAIL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_SECURE",
  "SMTP_ALLOW_CUSTOM_FROM",
  "SMTP_USE_STARTTLS_587",
  "EMAIL_HOST",
  "EMAIL_PORT",
  "EMAIL_PASS",
  "EMAIL_PASSWORD",
  "GMAIL_APP_PASSWORD",
  "GMAIL_FROM_EMAIL",
  "UNVERIFIED_BREVO_SENDERS",
  "ALLOW_UNVERIFIED_BREVO_SENDER",
  "OTP_EMAIL_PROVIDER",
  "OTP_EMAIL_PROVIDER_ORDER",
  "OTP_EMAIL_FORCE_API_PROVIDER",
  "OTP_EMAIL_PREFER_SMTP_OVER_API",
  "OTP_EMAIL_ALLOW_API_FALLBACK_AFTER_SMTP_FAILURE",
  "OTP_EMAIL_STRICT_SMTP",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "NODE_ENV",
];

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const restoreEnv = () => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
};

const importFreshOtpService = async () =>
  import(`../src/services/otpService.js?test=${Date.now()}-${Math.random()}`);

describe("OTP mail delivery", () => {
  const originalTransport = nodemailer.createTransport;
  beforeEach(() => {
    // Every SMTP test must stub delivery; provider regressions must never fall
    // through to credentials loaded from the developer's private .env.
    nodemailer.createTransport = () => { throw new Error('Unmocked SMTP transport in OTP test'); };
    process.env.OTP_EMAIL_PREFER_SMTP_OVER_API = "false";
  });
  afterEach(() => {
    restoreEnv();
    sinon.restore();
    nodemailer.createTransport = originalTransport;
    delete global.fetch;
  });

  it("can force the configured Brevo sender when it is not explicitly marked unverified", async () => {
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.OTP_EMAIL_PROVIDER = "brevo";
    process.env.OTP_EMAIL_FORCE_API_PROVIDER = "true";
    process.env.EMAIL_FROM = "info@humaeli.com";
    process.env.HUMAELI_EMAIL_FROM = "info@humaeli.com";
    process.env.EMAIL_USER = "info@humaeli.com";
    process.env.EMAIL = "info@humaeli.com";
    process.env.EMAIL_PASSWORD = "app-password";
    process.env.UNVERIFIED_BREVO_SENDERS = "";
    process.env.ALLOW_UNVERIFIED_BREVO_SENDER = "false";

    const fetchStub = sinon.stub().resolves({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ messageId: "brevo-msg-1" }),
    });
    global.fetch = fetchStub;

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP("User.Name@gmail.com", "123456");

    expect(result.provider).to.equal("brevo");
    expect(fetchStub.calledOnce).to.equal(true);

    const requestBody = JSON.parse(fetchStub.firstCall.args[1].body);
    expect(requestBody.sender.email).to.equal("info@humaeli.com");
    expect(requestBody.to[0].email).to.equal("User.Name@gmail.com");
  });

  it("uses Gmail SMTP as the primary OTP sender when Gmail credentials are configured", async () => {
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "info@humaeli.com";
    process.env.EMAIL_USER = "info@humaeli.com";
    process.env.EMAIL = "info@humaeli.com";
    process.env.EMAIL_PASSWORD = "app-password";
    delete process.env.OTP_EMAIL_PROVIDER;

    const sendMailStub = sinon.stub().resolves({ messageId: "gmail-msg-primary" });
    const createTransportStub = sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });
    const fetchStub = sinon.stub();
    global.fetch = fetchStub;

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP("person@gmail.com", "654321");

    expect(result.provider).to.equal("gmail");
    expect(createTransportStub.calledOnce).to.equal(true);
    expect(sendMailStub.calledOnce).to.equal(true);
    expect(fetchStub.called).to.equal(false);
  });

  it("keeps Gmail SMTP as the primary OTP sender on Railway/live runtime when configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.RAILWAY_ENVIRONMENT = "production";
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "info@mediconeckt.com";
    process.env.EMAIL_USER = "app.mediconeckt@gmail.com";
    process.env.EMAIL_PASSWORD = "app-password";
    process.env.UNVERIFIED_BREVO_SENDERS = "";
    delete process.env.OTP_EMAIL_PROVIDER;

    const sendMailStub = sinon.stub().resolves({ messageId: "gmail-msg-live" });
    const createTransportStub = sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });
    const fetchStub = sinon.stub().resolves({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ messageId: "brevo-live-msg" }),
    });
    global.fetch = fetchStub;

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP(
      "developer@mindcrawller.com",
      "445566",
    );

    expect(result.provider).to.equal("gmail");
    expect(createTransportStub.calledOnce).to.equal(true);
    expect(sendMailStub.calledOnce).to.equal(true);
    expect(fetchStub.called).to.equal(false);
  });

  it("prefers SMTP on live when SMTP preference is explicitly enabled", async () => {
    process.env.NODE_ENV = "production";
    process.env.OTP_EMAIL_PROVIDER = "brevo";
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "info@mediconeckt.com";
    process.env.EMAIL_USER = "app.mediconeckt@gmail.com";
    process.env.EMAIL_PASSWORD = "app-password";
    delete process.env.OTP_EMAIL_FORCE_API_PROVIDER;
    process.env.OTP_EMAIL_PREFER_SMTP_OVER_API = "true";

    const sendMailStub = sinon.stub().resolves({ messageId: "gmail-msg-forced-brevo" });
    const createTransportStub = sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });
    const fetchStub = sinon.stub();
    global.fetch = fetchStub;

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP(
      "developer@mindcrawller.com",
      "336699",
    );

    expect(result.provider).to.equal("gmail");
    expect(createTransportStub.calledOnce).to.equal(true);
    expect(sendMailStub.calledOnce).to.equal(true);
    expect(fetchStub.called).to.equal(false);
  });

  it("ignores legacy EMAIL_PROVIDER=brevo for OTP auto delivery when SMTP is configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_PROVIDER = "brevo";
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "info@mediconeckt.com";
    process.env.EMAIL_USER = "app.mediconeckt@gmail.com";
    process.env.EMAIL_PASSWORD = "app-password";
    delete process.env.OTP_EMAIL_PROVIDER;
    delete process.env.OTP_EMAIL_PROVIDER_ORDER;

    const sendMailStub = sinon.stub().resolves({ messageId: "gmail-msg-legacy" });
    const createTransportStub = sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });
    const fetchStub = sinon.stub();
    global.fetch = fetchStub;

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP(
      "developer@mindcrawller.com",
      "778899",
    );

    expect(result.provider).to.equal("gmail");
    expect(createTransportStub.calledOnce).to.equal(true);
    expect(sendMailStub.calledOnce).to.equal(true);
    expect(fetchStub.called).to.equal(false);
  });

  it("does not hide production SMTP failures behind Brevo fallback success", async () => {
    process.env.NODE_ENV = "production";
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "info@mediconeckt.com";
    process.env.EMAIL_USER = "app.mediconeckt@gmail.com";
    process.env.EMAIL_PASSWORD = "bad-password";
    delete process.env.OTP_EMAIL_PROVIDER;
    delete process.env.OTP_EMAIL_PROVIDER_ORDER;
    delete process.env.OTP_EMAIL_ALLOW_API_FALLBACK_AFTER_SMTP_FAILURE;

    const sendMailStub = sinon.stub().rejects(new Error("Invalid login"));
    sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });
    const fetchStub = sinon.stub().resolves({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ messageId: "brevo-should-not-send" }),
    });
    global.fetch = fetchStub;

    const { default: otpService } = await importFreshOtpService();

    try {
      await otpService.sendEmailOTP("developer@mindcrawller.com", "445566");
      throw new Error("Expected sendEmailOTP to fail");
    } catch (error) {
      expect(error.message).to.include("SMTP/Gmail delivery failed");
      expect(error.message).to.include("refusing API fallback in production");
    }

    expect(sendMailStub.calledOnce).to.equal(true);
    expect(fetchStub.called).to.equal(false);
  });

  it("uses the authenticated Gmail account as from address unless a custom alias is explicitly allowed", async () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.OTP_EMAIL_PROVIDER;
    process.env.EMAIL_HOST = "smtp.gmail.com";
    process.env.EMAIL_PORT = "587";
    process.env.EMAIL_FROM = "info@mediconeckt.com";
    process.env.EMAIL_USER = "app.mediconeckt@gmail.com";
    process.env.EMAIL_PASS = "app-password";

    const sendMailStub = sinon.stub().resolves({ messageId: "gmail-msg-from" });
    sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });

    const { default: otpService } = await importFreshOtpService();
    await otpService.sendEmailOTP("developer@mindcrawller.com", "654321");

    expect(sendMailStub.calledOnce).to.equal(true);
    expect(sendMailStub.firstCall.args[0].from).to.deep.equal({
      name: "Humaeli",
      address: "app.mediconeckt@gmail.com",
    });
  });

  it("defaults Gmail SMTP host to secure port 465 when no port is configured", async () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.OTP_EMAIL_PROVIDER;
    delete process.env.SMTP_PORT;
    delete process.env.EMAIL_PORT;
    process.env.EMAIL_HOST = "smtp.gmail.com";
    process.env.EMAIL_FROM = "info@mediconeckt.com";
    process.env.EMAIL_USER = "app.mediconeckt@gmail.com";
    process.env.EMAIL_PASS = "app-password";

    const sendMailStub = sinon.stub().resolves({ messageId: "gmail-msg-465" });
    const createTransportStub = sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP("developer@mindcrawller.com", "654321");

    expect(result.provider).to.equal("gmail");
    expect(createTransportStub.firstCall.args[0]).to.include({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
    });
  });

  it("supports EMAIL_HOST and EMAIL_PASS aliases from the existing env file", async () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PASS;
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_PORT = "587";
    process.env.EMAIL_FROM = "info@humaeli.com";
    process.env.EMAIL_USER = "info@humaeli.com";
    process.env.EMAIL_PASS = "app-password";
    delete process.env.OTP_EMAIL_PROVIDER;

    const sendMailStub = sinon.stub().resolves({ messageId: "smtp-msg-env-alias" });
    const createTransportStub = sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP("developer@mindcrawller.com", "654321");

    expect(result.provider).to.equal("gmail");
    expect(createTransportStub.calledOnce).to.equal(true);
    expect(createTransportStub.firstCall.args[0]).to.include({
      host: "smtp.example.com",
      port: 587,
      secure: false,
    });
    expect(sendMailStub.calledOnce).to.equal(true);
  });

  it("can force Resend as the OTP provider for stronger domain delivery", async () => {
    process.env.RESEND_API_KEY = "test-resend-key";
    process.env.RESEND_FROM_EMAIL = "otp@humaeli.com";
    process.env.OTP_EMAIL_PROVIDER = "resend";
    process.env.OTP_EMAIL_FORCE_API_PROVIDER = "true";
    delete process.env.BREVO_API_KEY;
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL;
    delete process.env.EMAIL_PASSWORD;
    delete process.env.EMAIL_PASS;

    const fetchStub = sinon.stub().resolves({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ id: "resend-msg-1" }),
    });
    global.fetch = fetchStub;

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP("developer@mindcrawller.com", "112233");

    expect(result.provider).to.equal("resend");
    expect(result.messageId).to.equal("resend-msg-1");
    expect(fetchStub.calledOnce).to.equal(true);

    const requestBody = JSON.parse(fetchStub.firstCall.args[1].body);
    expect(fetchStub.firstCall.args[0]).to.equal("https://api.resend.com/emails");
    expect(requestBody.from).to.equal("Humaeli <otp@humaeli.com>");
    expect(requestBody.to).to.deep.equal(["developer@mindcrawller.com"]);
  });

  it("falls back to Brevo when Gmail SMTP fails", async () => {
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "info@humaeli.com";
    process.env.EMAIL_USER = "info@humaeli.com";
    process.env.EMAIL = "info@humaeli.com";
    process.env.EMAIL_PASSWORD = "app-password";
    delete process.env.OTP_EMAIL_PROVIDER;

    const sendMailStub = sinon.stub().rejects(new Error("Invalid login"));
    const createTransportStub = sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });

    global.fetch = sinon.stub().resolves({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ messageId: "brevo-msg-fallback" }),
    });

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendLoginOTP("person@gmail.com", "654321");

    expect(result.provider).to.equal("brevo");
    expect(createTransportStub.calledOnce).to.equal(true);
    expect(sendMailStub.calledOnce).to.equal(true);
    expect(global.fetch.calledOnce).to.equal(true);
  });
});
