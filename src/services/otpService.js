import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import nodemailer from "nodemailer";
import twilio from "twilio";

export const PLAY_REVIEW_TEST_EMAILS = Object.freeze([
  "playstore.user@humaeli.com",
  "playstore.counsellor@humaeli.com",
]);

const configuredPlayReviewEmails = String(
  process.env.PLAY_REVIEW_TEST_EMAILS || PLAY_REVIEW_TEST_EMAILS.join(","),
)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const playReviewEmailSet = new Set(configuredPlayReviewEmails);
const PLAY_REVIEW_FIXED_OTP = "123456";

const FROM_NAME = "Humaeli";

// ⚠️ IMPORTANT: Brevo sender email must exactly match an authenticated sender/domain.
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@humaeli.com";
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEFAULT_EMAIL_TEXT = "Please enable HTML to view this email.";
const DEFAULT_FROM_EMAIL = "support@humaeli.com";
const VERIFIED_FALLBACK_FROM_EMAIL = String(
  process.env.VERIFIED_EMAIL_FROM || DEFAULT_FROM_EMAIL,
).trim();
const RESEND_FROM_EMAIL = String(
  process.env.RESEND_FROM_EMAIL ||
    process.env.HUMAELI_RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    process.env.HUMAELI_EMAIL_FROM ||
    VERIFIED_FALLBACK_FROM_EMAIL,
).trim();
const OTP_EMAIL_TIMEOUT_MS = Number(process.env.OTP_EMAIL_TIMEOUT_MS || 15000);
const ALLOW_UNVERIFIED_BREVO_SENDER =
  process.env.ALLOW_UNVERIFIED_BREVO_SENDER === "true";
const UNVERIFIED_BREVO_SENDERS = new Set(
  String(process.env.UNVERIFIED_BREVO_SENDERS ?? "info@humaeli.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
const GMAIL_SMTP_USER = String(
  process.env.EMAIL_USER || process.env.EMAIL || "",
).trim();
const GMAIL_SMTP_PASS = String(
  process.env.EMAIL_PASSWORD ||
    process.env.EMAIL_PASS ||
    process.env.GMAIL_APP_PASSWORD ||
    "",
).trim();
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const EMAIL_HOST = String(process.env.EMAIL_HOST || "").trim();
const ACTIVE_SMTP_HOST = SMTP_HOST || EMAIL_HOST;
const isGmailSmtpHost =
  !ACTIVE_SMTP_HOST || /(^|\.)gmail\.com$/i.test(ACTIVE_SMTP_HOST);
const configuredSmtpPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
const shouldUseGmailSslPort =
  isGmailSmtpHost &&
  (!configuredSmtpPort ||
    (Number(configuredSmtpPort) === 587 &&
      process.env.SMTP_USE_STARTTLS_587 !== "true"));
const SMTP_PORT = Number(
  shouldUseGmailSslPort ? 465 : configuredSmtpPort || 587,
);
const SMTP_SECURE =
  String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
  SMTP_PORT === 465;
const SMTP_USER = String(process.env.SMTP_USER || process.env.EMAIL_USER || "").trim();
const SMTP_PASS = String(
  process.env.SMTP_PASS ||
    process.env.EMAIL_PASS ||
    process.env.EMAIL_PASSWORD ||
    process.env.GMAIL_APP_PASSWORD ||
    "",
).trim();
const SMTP_FROM_EMAIL = String(
  process.env.EMAIL_FROM ||
    process.env.HUMAELI_EMAIL_FROM ||
    process.env.EMAIL_USER ||
    process.env.EMAIL ||
    DEFAULT_FROM_EMAIL,
).trim();
const BREVO_FROM_EMAIL = String(
  process.env.BREVO_FROM_EMAIL ||
    process.env.HUMAELI_BREVO_FROM_EMAIL ||
    SMTP_FROM_EMAIL,
).trim();
const EXPLICIT_OTP_EMAIL_PROVIDER = String(process.env.OTP_EMAIL_PROVIDER || "")
  .trim()
  .toLowerCase();
const LEGACY_EMAIL_PROVIDER = String(process.env.EMAIL_PROVIDER || "")
  .trim()
  .toLowerCase();
const OTP_EMAIL_PROVIDER = EXPLICIT_OTP_EMAIL_PROVIDER || "auto";
const OTP_EMAIL_PROVIDER_ORDER = String(process.env.OTP_EMAIL_PROVIDER_ORDER || "")
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
const OTP_EMAIL_PREFER_SMTP_OVER_API =
  process.env.OTP_EMAIL_PREFER_SMTP_OVER_API === "true";
const ALLOW_API_FALLBACK_AFTER_SMTP_FAILURE =
  process.env.OTP_EMAIL_ALLOW_API_FALLBACK_AFTER_SMTP_FAILURE === "true";
const activeBrevoFromEmail =
  !ALLOW_UNVERIFIED_BREVO_SENDER &&
  UNVERIFIED_BREVO_SENDERS.has(BREVO_FROM_EMAIL.toLowerCase())
    ? VERIFIED_FALLBACK_FROM_EMAIL
    : BREVO_FROM_EMAIL || VERIFIED_FALLBACK_FROM_EMAIL;
const SENDER_EMAILS = [
  ...new Set([activeBrevoFromEmail, VERIFIED_FALLBACK_FROM_EMAIL].filter(Boolean)),
];
const SMTP_AUTH_USER = SMTP_USER || GMAIL_SMTP_USER;
const ALLOW_CUSTOM_SMTP_FROM = process.env.SMTP_ALLOW_CUSTOM_FROM === "true";
const SMTP_MAIL_FROM_EMAIL =
  isGmailSmtpHost &&
  SMTP_AUTH_USER &&
  SMTP_FROM_EMAIL.toLowerCase() !== SMTP_AUTH_USER.toLowerCase() &&
  !ALLOW_CUSTOM_SMTP_FROM
    ? SMTP_AUTH_USER
    : SMTP_FROM_EMAIL;

if (!BREVO_API_KEY) {
  console.error("❌ Brevo API key is not configured. Set BREVO_API_KEY in .env.");
}

if (activeBrevoFromEmail !== BREVO_FROM_EMAIL) {
  console.warn(`⚠️ Ignoring unverified Brevo sender: ${BREVO_FROM_EMAIL}`);
  console.warn("   Active Brevo sender:", activeBrevoFromEmail);
}

const hasSmtpConfig = Boolean(
  (ACTIVE_SMTP_HOST && SMTP_USER && SMTP_PASS) ||
    (GMAIL_SMTP_USER && GMAIL_SMTP_PASS),
);
const hasBrevoConfig = Boolean(BREVO_API_KEY);
const hasResendConfig = Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL);
const usingAutoProviderSelection =
  !EXPLICIT_OTP_EMAIL_PROVIDER && OTP_EMAIL_PROVIDER_ORDER.length === 0;
const hasApiProviderPreference =
  ["brevo", "sendinblue", "resend"].includes(EXPLICIT_OTP_EMAIL_PROVIDER) ||
  OTP_EMAIL_PROVIDER_ORDER.some((provider) =>
    ["brevo", "sendinblue", "resend"].includes(provider),
  );
const stopAfterSmtpFailure =
  process.env.OTP_EMAIL_STRICT_SMTP === "true" ||
  (process.env.NODE_ENV === "production" &&
    (usingAutoProviderSelection ||
      (hasApiProviderPreference && OTP_EMAIL_PREFER_SMTP_OVER_API)) &&
    hasSmtpConfig &&
    !ALLOW_API_FALLBACK_AFTER_SMTP_FAILURE);
const primaryProvider = getConfiguredProviders()[0];
const primarySenderEmail =
  primaryProvider === "resend"
    ? RESEND_FROM_EMAIL
    : primaryProvider === "brevo"
    ? activeBrevoFromEmail
    : primaryProvider === "gmail"
    ? SMTP_MAIL_FROM_EMAIL
    : "none";

if (primaryProvider) {
  console.log("✅ Primary sender email configured:", primarySenderEmail);
} else {
  console.warn("OTP email provider is not configured. Set SMTP or email API credentials in the deployment environment.");
}

if (LEGACY_EMAIL_PROVIDER && !EXPLICIT_OTP_EMAIL_PROVIDER) {
  console.warn(
    `⚠️ EMAIL_PROVIDER=${LEGACY_EMAIL_PROVIDER} is ignored for OTP delivery.`,
  );
  console.warn(
    "   Set OTP_EMAIL_PROVIDER or OTP_EMAIL_PROVIDER_ORDER only after the live sender is verified.",
  );
}

if (SMTP_MAIL_FROM_EMAIL !== SMTP_FROM_EMAIL) {
  console.warn(
    `⚠️ Gmail SMTP sender changed from ${SMTP_FROM_EMAIL} to authenticated user ${SMTP_MAIL_FROM_EMAIL}.`,
  );
  console.warn("   Set SMTP_ALLOW_CUSTOM_FROM=true only if the Gmail alias is verified.");
}

const buildBrevoPayload = ({ senderEmail, to, subject, html, text }) => ({
  sender: { name: FROM_NAME, email: senderEmail },
  to: [{ email: to }],
  subject,
  htmlContent: html || "",
  textContent: text || DEFAULT_EMAIL_TEXT,
  replyTo: {
    email: SUPPORT_EMAIL,
    name: "Humaeli Support",
  },
  headers: {
    "X-Mailer": "Humaeli Mail Service",
    "X-Priority": "3",
    "X-Auto-Response-Suppress": "All",
  },
  amp4email: false,
});

async function sendBrevoRequest(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OTP_EMAIL_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : { message: await response.text() };

    if (!response.ok) {
      const errorMessage = data?.message || data?.error || `Brevo API error ${response.status}`;
      const error = new Error(errorMessage);
      error.status = response.status;
      error.body = data;
      throw error;
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`Brevo request timed out after ${OTP_EMAIL_TIMEOUT_MS}ms`);
      timeoutError.code = "OTP_EMAIL_TIMEOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendBrevoEmail({ to, subject, html, text }) {
  if (!BREVO_API_KEY) {
    throw new Error("Brevo API key is missing. Cannot send email.");
  }

  let lastError;
  for (const senderEmail of SENDER_EMAILS) {
    try {
      const payload = buildBrevoPayload({
        senderEmail,
        to,
        subject,
        html,
        text,
      });

      const data = await sendBrevoRequest(payload);
      if (senderEmail !== activeBrevoFromEmail) {
        console.log(`✅ Email sent using fallback sender ${senderEmail}.`);
      }
      return data;
    } catch (error) {
      lastError = error;
      const message = String(error.message || "").toLowerCase();
      console.warn(
        `Brevo send failed for sender ${senderEmail}: ${message}`,
        error.body || error,
      );

      if (
        senderEmail === SENDER_EMAILS[SENDER_EMAILS.length - 1] ||
        !/sender|from.*email|sender.*id|unverified/i.test(message)
      ) {
        break;
      }
    }
  }

  throw new Error(
    `Failed to send email via Brevo. Last error: ${lastError?.message || "Unknown error"}`,
  );
}

async function sendResendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error("Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${RESEND_FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
      text: text || DEFAULT_EMAIL_TEXT,
      reply_to: SUPPORT_EMAIL,
      headers: {
        "X-Mailer": "Humaeli Mail Service",
        "X-Auto-Response-Suppress": "All",
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = data?.message || data?.error || `Resend API error ${response.status}`;
    const error = new Error(errorMessage);
    error.status = response.status;
    error.body = data;
    throw error;
  }

  return { ...data, messageId: data?.id };
}

async function sendGmailEmail({ to, subject, html, text }) {
  const transporterOptions =
    ACTIVE_SMTP_HOST && SMTP_USER && SMTP_PASS
      ? {
          host: ACTIVE_SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_SECURE,
          family: 4,
          auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
          },
          connectionTimeout: OTP_EMAIL_TIMEOUT_MS,
          greetingTimeout: OTP_EMAIL_TIMEOUT_MS,
          socketTimeout: OTP_EMAIL_TIMEOUT_MS,
        }
      : {
          service: "gmail",
          auth: {
            user: GMAIL_SMTP_USER,
            pass: GMAIL_SMTP_PASS,
          },
          family: 4,
          connectionTimeout: OTP_EMAIL_TIMEOUT_MS,
          greetingTimeout: OTP_EMAIL_TIMEOUT_MS,
          socketTimeout: OTP_EMAIL_TIMEOUT_MS,
        };

  const transporter = nodemailer.createTransport(transporterOptions);

  if (process.env.NODE_ENV !== "production" && typeof transporter.verify === "function") {
    try {
      await transporter.verify();
      console.log("SMTP ready");
    } catch (error) {
      console.error("SMTP connection failed:", error.message);
    }
  }

  return transporter.sendMail({
    from: {
      name: FROM_NAME,
      address: SMTP_MAIL_FROM_EMAIL,
    },
    replyTo: SUPPORT_EMAIL,
    to,
    subject,
    html,
    text,
  });
}

function getConfiguredProviders() {
  const preferSmtpWhenRequested = (providers) => {
    const hasApiProvider = providers.some((provider) =>
      ["brevo", "resend"].includes(provider),
    );

    if (!hasSmtpConfig || !hasApiProvider || !OTP_EMAIL_PREFER_SMTP_OVER_API) {
      return providers;
    }

    return [
      "gmail",
      ...providers.filter((provider) => provider !== "gmail"),
    ];
  };

  if (["brevo", "sendinblue"].includes(OTP_EMAIL_PROVIDER)) {
    return preferSmtpWhenRequested(hasBrevoConfig ? ["brevo"] : []);
  }

  if (OTP_EMAIL_PROVIDER === "resend") {
    return preferSmtpWhenRequested(hasResendConfig ? ["resend"] : []);
  }

  if (["gmail", "smtp"].includes(OTP_EMAIL_PROVIDER)) {
    return hasSmtpConfig ? ["gmail"] : [];
  }

  if (OTP_EMAIL_PROVIDER_ORDER.length > 0) {
    const providerSet = new Set(
      OTP_EMAIL_PROVIDER_ORDER.map((provider) => {
        if (provider === "smtp") return "gmail";
        if (provider === "sendinblue") return "brevo";
        return provider;
      }),
    );
    const orderedProviders = [...providerSet].filter((provider) => {
      if (provider === "gmail") return hasSmtpConfig;
      if (provider === "resend") return hasResendConfig;
      if (provider === "brevo") return hasBrevoConfig;
      return false;
    });
    return preferSmtpWhenRequested(orderedProviders);
  }

  // Keep auto mode consistent across local and live. The local app usually uses
  // Gmail/SMTP successfully; choosing Brevo first only in production, or via a
  // legacy EMAIL_PROVIDER=brevo value, can make live OTP responses look
  // successful while the recipient never sees the mail.
  // Use OTP_EMAIL_PROVIDER or OTP_EMAIL_PROVIDER_ORDER to force a different
  // live order after the sender/domain is fully verified.
  const providers = [];
  if (hasSmtpConfig) providers.push("gmail");
  if (hasResendConfig) providers.push("resend");
  if (hasBrevoConfig) providers.push("brevo");
  return providers;
}

export async function sendTransactionalEmail({ to, subject, html, text }) {
  const providers = getConfiguredProviders();

  let lastError;

  for (const provider of providers) {
    try {
      if (provider === "gmail") {
        const data = await sendGmailEmail({ to, subject, html, text });
        return { ...data, provider: "gmail" };
      }

      if (provider === "resend") {
        const data = await sendResendEmail({ to, subject, html, text });
        return { ...data, provider: "resend" };
      }

      if (!BREVO_API_KEY) continue;
      const data = await sendBrevoEmail({ to, subject, html, text });
      return { ...data, provider: "brevo" };
    } catch (error) {
      lastError = error;
      if (provider === "gmail" && stopAfterSmtpFailure) {
        const strictSmtpError = new Error(
          `SMTP/Gmail delivery failed for ${to}; refusing API fallback in production because it can report success without inbox delivery. ` +
            `Fix live EMAIL_USER/EMAIL_PASSWORD or set OTP_EMAIL_ALLOW_API_FALLBACK_AFTER_SMTP_FAILURE=true after Brevo/Resend sender verification. ` +
            `Original error: ${error.message}`,
        );
        strictSmtpError.nonRetryable = true;
        throw strictSmtpError;
      }

      if (provider !== providers[providers.length - 1]) {
        console.warn(
          `${provider.toUpperCase()} delivery failed for ${to}. Trying next provider: ${error.message}`,
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("No email provider is configured for OTP delivery.");
}

export function getEmailDeliveryDiagnostics() {
  return {
    primaryProvider: primaryProvider || "none",
    configuredProviders: getConfiguredProviders(),
    hasSmtpConfig,
    hasBrevoConfig,
    hasResendConfig,
    smtpPort: hasSmtpConfig ? SMTP_PORT : null,
    smtpSecure: hasSmtpConfig ? SMTP_SECURE : null,
    preferSmtpOverApi: OTP_EMAIL_PREFER_SMTP_OVER_API,
    ignoresLegacyEmailProvider: Boolean(
      LEGACY_EMAIL_PROVIDER && !EXPLICIT_OTP_EMAIL_PROVIDER,
    ),
    strictSmtpDelivery: stopAfterSmtpFailure,
  };
}

const buildEmailOTPHtml = (otp) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Email Verification - Humaeli</title>
  <style>
    body { margin: 0; padding: 0; background: #f9f9f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
    .container { max-width: 600px; margin: 20px auto; border: 1px solid #e6e6e6; border-radius: 10px; overflow: hidden; background: white; }
    .header { background: #2e7d32; padding: 20px; text-align: center; color: white; }
    .header h2 { margin: 0; font-size: 22px; font-weight: 600; }
    .header p { margin: 6px 0 0; font-size: 14px; opacity: 0.9; }
    .content { padding: 30px; }
    .content h3 { color: #222; margin-top: 0; margin-bottom: 15px; }
    .content p { color: #444; line-height: 1.7; margin: 12px 0; }
    .otp-box { text-align: center; margin: 30px 0; }
    .otp-code { font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #ffffff; padding: 15px 30px; background: #2e7d32; border-radius: 8px; display: inline-block; }
    .divider { border: none; border-top: 1px solid #e6e6e6; margin: 24px 0; }
    .footer { font-size: 12px; color: #666; line-height: 1.7; }
    .footer a { color: #2e7d32; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Humaeli - Mental Wellness</h2>
      <p>Healthcare Connecting Platform</p>
    </div>
    <div class="content">
      <h3>Verify Your Email Address</h3>
      <p>Thank you for creating an account with Humaeli. To complete your registration and access all features of our healthcare platform, please verify your email address by entering the verification code below.</p>
      <p>Your one-time verification code is:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p><strong>Code Expiration:</strong> This verification code is valid for 10 minutes from when this email was sent. Do not share this code with anyone.</p>
      <p>Once verified, you will gain full access to your Humaeli account including appointments, health records, and doctor consultations.</p>
      <p><strong>Security Note:</strong> If you did not create a Humaeli account, you can safely ignore this email. No account will be activated without verification.</p>
      <hr class="divider" />
      <div class="footer">
        <p>This is a transactional email from Humaeli sent to confirm your email address.<br/>
        For support, contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a><br/>
        &copy; ${new Date().getFullYear()} Humaeli Indore, Madhya Pradesh, India</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

const buildLoginOTPHtml = (otp) => `
<!DOCTYPE html>
<html lang="en">    
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Login Verification - Humaeli</title>
  <style>
    body { margin: 0; padding: 0; background: #f9f9f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
    .container { max-width: 600px; margin: 20px auto; border: 1px solid #e6e6e6; border-radius: 10px; overflow: hidden; background: white; }
    .header { background: #2e7d32; padding: 20px; text-align: center; color: white; }
    .header h2 { margin: 0; font-size: 22px; font-weight: 600; }
    .header p { margin: 6px 0 0; font-size: 14px; opacity: 0.9; }
    .content { padding: 30px; }
    .content h3 { color: #222; margin-top: 0; margin-bottom: 15px; }
    .content p { color: #444; line-height: 1.7; margin: 12px 0; }
    .otp-box { text-align: center; margin: 30px 0; }
    .otp-code { font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #ffffff; padding: 15px 30px; background: #2e7d32; border-radius: 8px; display: inline-block; }
    .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 15px; margin: 15px 0; border-radius: 4px; }
    .warning p { margin: 0; color: #856404; font-size: 14px; }
    .divider { border: none; border-top: 1px solid #e6e6e6; margin: 24px 0; }
    .footer { font-size: 12px; color: #666; line-height: 1.7; }
    .footer a { color: #2e7d32; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Humaeli - Mental Wellness</h2>
      <p>Healthcare Connecting Platform</p>
    </div>
    <div class="content">
      <h3>Confirm Your Login</h3>
      <p>We received a request to sign in to your Humaeli account. To confirm this is you and keep your account secure, please enter the verification code below.</p>
      <p>Your one-time login verification code is:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p><strong>Code Expiration:</strong> This verification code is valid for 10 minutes. Do not share this code with anyone, including Humaeli support staff.</p>
      <div class="warning">
        <p><strong>⚠️ Security Alert:</strong> If you did not attempt to log in, your account credentials may be compromised. Change your password immediately and contact our support team.</p>
      </div>
      <hr class="divider" />
      <div class="footer">
        <p>This is a transactional email from Humaeli sent for account security.<br/>
        For support, contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a><br/>
        &copy; ${new Date().getFullYear()} Humaeli Indore, Madhya Pradesh, India</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

class OTPService {
  isPlayReviewEmail(email) {
    return playReviewEmailSet.has(String(email || "").trim().toLowerCase());
  }

  generateOTP(email = "") {
    if (this.isPlayReviewEmail(email)) {
      return PLAY_REVIEW_FIXED_OTP;
    }

    return crypto.randomInt(100000, 999999).toString();
  }

  async sendLoginOTP(email, otp) {
    try {
      const textContent =
        `Humaeli - Mental Wellness - Login Verification\n\n` +
        `We received a request to sign in to your Humaeli account.\n` +
        `To keep your account secure, please verify with the code below:\n\n` +
        `Verification Code: ${otp}\n` +
        `Expires in: 10 minutes\n\n` +
        `SECURITY: Do not share this code with anyone.\n` +
        `If this wasn't you, change your password immediately at ${SUPPORT_EMAIL}\n\n` +
        `©️ ${new Date().getFullYear()} Humaeli `;

      const data = await sendTransactionalEmail({
        to: email,
        subject: "[Humaeli] Your login verification code",
        html: buildLoginOTPHtml(otp),
        text: textContent,
      });

      console.log(
        `✅ Login OTP sent to ${email} | MessageID: ${data?.messageId}`,
      );
      return data;
    } catch (error) {
      console.error(`❌ Login OTP failed for ${email}:`, error.message);
      throw error;
    }
  }

  async sendPasswordResetOTP(email, otp) {
    const year = new Date().getFullYear();
    const html = `
      <div style="max-width:600px;margin:20px auto;border:1px solid #e6e6e6;border-radius:10px;overflow:hidden;background:#fff;font-family:Arial,sans-serif;">
        <div style="background:#667eea;padding:20px;text-align:center;color:#fff;">
          <h2 style="margin:0;">Humaeli</h2>
          <p style="margin:6px 0 0;">Password reset verification</p>
        </div>
        <div style="padding:30px;">
          <h3 style="color:#333;margin-top:0;">Reset your password</h3>
          <p style="color:#555;line-height:1.6;">Use the verification code below to reset your Humaeli password.</p>
          <div style="margin:28px 0;text-align:center;">
            <span style="display:inline-block;background:#eef2ff;color:#4f46e5;border-radius:8px;padding:15px 28px;font-size:32px;font-weight:bold;letter-spacing:8px;">${otp}</span>
          </div>
          <p style="color:#555;line-height:1.6;">This code is valid for 10 minutes. Do not share it with anyone.</p>
          <p style="color:#777;font-size:13px;line-height:1.6;">If you did not request a password reset, you can safely ignore this email.</p>
          <hr style="border:none;border-top:1px solid #e6e6e6;margin:24px 0;" />
          <p style="color:#777;font-size:12px;">&copy; ${year} Humaeli Global Pvt Ltd | Bhopal, India</p>
        </div>
      </div>
    `;
    const text =
      `Humaeli password reset verification\n\n` +
      `Verification code: ${otp}\n` +
      `This code expires in 10 minutes.\n\n` +
      `Do not share this code. If you did not request a password reset, ignore this email.\n\n` +
      `©️ ${year} Humaeli Global Pvt Ltd`;

    try {
      const data = await sendTransactionalEmail({
        to: email,
        subject: "[Humaeli] Password reset verification code",
        html,
        text,
      });

      console.log(
        `✅ Password reset OTP sent to ${email} | MessageID: ${data?.messageId}`,
      );
      return data;
    } catch (error) {
      console.error(
        `❌ Password reset OTP failed for ${email}:`,
        error.message,
      );
      throw error;
    }
  }

  async sendEmailOTP(email, otp) {
    console.log(`📧 Sending email verification OTP to ${email}`);

    const textContent =
      `Humaeli - Email Verification\n\n` +
      `Thank you for registering with Humaeli.\n` +
      `Please verify your email to access all features.\n\n` +
      `Verification Code: ${otp}\n` +
      `Expires in: 10 minutes\n\n` +
      `Do not share this code. If you didn't sign up, ignore this email.\n\n` +
      `Questions? Contact: ${SUPPORT_EMAIL}\n\n` +
      `©️ ${new Date().getFullYear()} Humaeli Global Pvt Ltd | Bhopal, India`;

    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const data = await sendTransactionalEmail({
          to: email,
          subject: "[Humaeli] Email verification code",
          html: buildEmailOTPHtml(otp),
          text: textContent,
        });

        console.log(
          `✅ Email OTP sent successfully to ${email} | MessageID: ${data?.messageId}`,
        );
        return data;
      } catch (error) {
        lastError = error;

        // Don't retry 4xx client errors (bad email, invalid key, etc.)
        const status = error?.response?.status || error?.status || 0;
        const isClientError = status >= 400 && status < 500;

        if (isClientError || error?.nonRetryable) {
          console.error(
            `❌ Non-retryable email error (${status || "delivery"}) - not retrying: ${error?.message}`,
          );
          break;
        }

        if (attempt === maxRetries) {
          console.error(`❌ Final attempt (${attempt}/${maxRetries}) failed`);
          break;
        }

        const waitTime = 2000 * attempt;
        console.log(
          `⏳ Retry ${attempt + 1}/${maxRetries} in ${waitTime}ms... (${error?.message})`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    throw new Error(
      `Failed to send email OTP to ${email}: ${lastError?.message || "Unknown error"}`,
    );
  }

  async sendForgotPasswordOTP(email, otp) {
    const year = new Date().getFullYear();
    const textContent =
      `Humaeli - Password Reset\n\n` +
      `We received a request to reset your Humaeli account password.\n` +
      `Use the code below to continue:\n\n` +
      `Password reset code: ${otp}\n` +
      `Expires in: 10 minutes\n\n` +
      `Do not share this code. If you did not request a password reset, ignore this email.\n\n` +
      `Questions? Contact: ${SUPPORT_EMAIL}\n\n` +
      `Copyright ${year} Humaeli Global Pvt Ltd | Bhopal, India`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password Reset - Humaeli</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:20px auto;border:1px solid #e6e6e6;border-radius:10px;overflow:hidden;background:white;">
    <div style="background:#2e7d32;padding:20px;text-align:center;color:white;">
      <h2 style="margin:0;font-size:22px;">Humaeli Global Pvt Ltd</h2>
      <p style="margin:6px 0 0;font-size:14px;">Healthcare Connecting Platform</p>
    </div>
    <div style="padding:30px;">
      <h3 style="color:#222;margin-top:0;">Reset Your Password</h3>
      <p style="color:#444;line-height:1.7;">We received a request to reset your password. Enter this one-time code in the app to continue.</p>
      <div style="text-align:center;margin:30px 0;">
        <div style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#fff;padding:15px 30px;background:#2e7d32;border-radius:8px;display:inline-block;">${otp}</div>
      </div>
      <p style="color:#444;line-height:1.7;"><strong>Code Expiration:</strong> This code is valid for 10 minutes. Do not share it with anyone.</p>
      <p style="color:#444;line-height:1.7;">If you did not request a password reset, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #e6e6e6;margin:24px 0;" />
      <p style="font-size:12px;color:#666;line-height:1.7;">This is a transactional email from Humaeli sent for account security.<br/>For support, contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#2e7d32;text-decoration:none;">${SUPPORT_EMAIL}</a><br/>Copyright ${year} Humaeli Global Pvt Ltd | Bhopal, Madhya Pradesh, India</p>
    </div>
  </div>
</body>
</html>`;

    try {
      const data = await sendTransactionalEmail({
        to: email,
        subject: "[Humaeli] Password reset code",
        html,
        text: textContent,
      });

      console.log(
        `Forgot password OTP sent to ${email} | MessageID: ${data?.messageId}`,
      );
      return data;
    } catch (error) {
      console.error(`Forgot password OTP failed for ${email}:`, error.message);
      throw error;
    }
  }

  verifyOTP(user, type, enteredOTP) {
    const otpData = type === "email" ? user.emailOTP : user.phoneOTP;

    if (!otpData || !otpData.code) {
      return { valid: false, message: "OTP not found or already verified" };
    }

    if (new Date() > otpData.expiresAt) {
      return {
        valid: false,
        message: "OTP has expired. Please request a new one.",
      };
    }

    if (otpData.code !== enteredOTP) {
      return {
        valid: false,
        message: "Invalid OTP. Please check and try again.",
      };
    }

    return { valid: true, message: "OTP verified successfully" };
  }

  clearOTP(user, type) {
    if (type === "email") {
      user.emailOTP = null;
    } else if (type === "phone") {
      user.phoneOTP = null;
    }
    console.log(`OTP cleared for ${type}`);
  }
}

export default new OTPService();
