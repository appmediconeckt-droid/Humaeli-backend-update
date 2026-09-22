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
const VERIFIED_FALLBACK_FROM_EMAIL =
  process.env.VERIFIED_EMAIL_FROM || "info@humaeli.com";
const UNVERIFIED_BREVO_SENDERS = new Set(["info@humaeli.com"]);
const configuredFromEmail =
  process.env.EMAIL_FROM ||
  process.env.HUMAELI_EMAIL_FROM ||
  process.env.EMAIL_USER ||
  process.env.EMAIL;
const FROM_EMAIL =
  configuredFromEmail === "info@humaeli.com"
    ? VERIFIED_FALLBACK_FROM_EMAIL
    : configuredFromEmail || VERIFIED_FALLBACK_FROM_EMAIL;
const SENDER_EMAILS = [...new Set([FROM_EMAIL, VERIFIED_FALLBACK_FROM_EMAIL])];
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@humaeli.com";
const BREVO_API_KEY = process.env.BREVO_API_KEY;

// Gmail SMTP Credentials
const SMTP_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.EMAIL_PORT || 587);
const SMTP_USER = String(
  process.env.SMTP_USER || process.env.EMAIL_USER || process.env.EMAIL || "",
).trim();
const SMTP_PASS = String(
  process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD || "",
).trim();

let gmailTransporter = null;
function getGmailTransporter() {
  if (!gmailTransporter) {
    gmailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }
  return gmailTransporter;
}

if (!BREVO_API_KEY && !SMTP_PASS) {
  console.error("❌ No email service configured. Set EMAIL_PASS or BREVO_API_KEY in .env.");
}

if (configuredFromEmail === "info@humaeli.com") {
  console.warn(
    `⚠️ Ignoring unverified Brevo sender(s): ${[...UNVERIFIED_BREVO_SENDERS].join(", ")}`,
  );
  console.warn("   Active FROM_EMAIL:", FROM_EMAIL);
} else {
  console.log("✅ Primary sender email configured:", FROM_EMAIL);
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
    "List-Unsubscribe": `<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
    "X-Mailer": "Humaeli Mail Service",
    "X-Priority": "3",
  },
  amp4email: false,
  trackingParams: "utm_source=humaeli&utm_medium=email",
});

async function sendBrevoRequest(payload) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
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
      if (senderEmail !== FROM_EMAIL) {
        console.log(
          `✅ Email sent using fallback sender ${senderEmail} because primary sender failed or was unavailable.`,
        );
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
        continue;
      }
    }
  }

  throw new Error(
    `Failed to send email via Brevo. Last error: ${lastError?.message || "Unknown error"}`,
  );
}

async function sendGmailEmail({ to, subject, html, text }) {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error("Gmail SMTP credentials not configured");
  }
  const transporter = getGmailTransporter();
  const info = await transporter.sendMail({
    from: `"${FROM_NAME}" <${SMTP_USER}>`,
    to,
    subject,
    html,
    text,
  });
  return { messageId: info.messageId, provider: "gmail" };
}

async function sendTransactionalEmail({ to, subject, html, text }) {
  // If Gmail SMTP credentials are configured, prioritize direct Gmail delivery
  // so emails pass SPF/DKIM/DMARC and land straight in recipient inboxes
  if (SMTP_USER && SMTP_PASS) {
    try {
      const result = await sendGmailEmail({ to, subject, html, text });
      console.log(`✅ Email delivered via Gmail SMTP to ${to} | ID: ${result.messageId}`);
      return result;
    } catch (err) {
      console.warn(`⚠️ Gmail SMTP delivery failed for ${to}: ${err.message}. Trying Brevo fallback...`);
    }
  }

  // Fallback to Brevo
  if (BREVO_API_KEY) {
    const brevoResult = await sendBrevoEmail({ to, subject, html, text });
    return { ...brevoResult, provider: "brevo" };
  }

  throw new Error("No working email delivery service available (Gmail SMTP or Brevo API)");
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

        if (isClientError) {
          console.error(
            `❌ Client error (${status}) - not retrying: ${error?.message}`,
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