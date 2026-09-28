// utils/emailService.js
import {
  SUPPORT_EMAIL,
  sendTransactionalEmail,
} from "../services/otpService.js";

export const sendResetPasswordEmail = async (email, resetUrl) => {
  const year = new Date().getFullYear();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset Your Password - Humaeli</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:20px auto;border:1px solid #e6e6e6;border-radius:10px;overflow:hidden;background:white;">
    <div style="background:#4CAF50;padding:15px;text-align:center;color:white;">
      <h2 style="margin:0;">Humaeli Global Pvt Ltd</h2>
    </div>
    <div style="padding:20px;">
      <h3 style="color:#333;">Reset Your Password</h3>
      <p style="color:#555;line-height:1.6;">
        We received a request to reset the password for your
        <a href="https://humaeli.com" style="color:#4CAF50;text-decoration:none;">Humaeli</a> account.
        Click the button below to set a new password.
      </p>
      <div style="text-align:center;margin:30px 0;">
        <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#4CAF50;color:white;text-decoration:none;border-radius:6px;font-size:16px;font-weight:bold;">
          Reset Password
        </a>
      </div>
      <p style="color:#555;line-height:1.6;">
        Or copy this link into your browser:<br/>
        <a href="${resetUrl}" style="color:#4CAF50;word-break:break-all;">${resetUrl}</a>
      </p>
      <p style="color:#555;line-height:1.6;">This link is valid for <strong>10 minutes</strong>.</p>
      <p style="color:#555;line-height:1.6;">If you did not request a password reset, please ignore this email. Your password will not change.</p>
      <hr style="border:none;border-top:1px solid #e6e6e6;margin:20px 0;"/>
      <p style="font-size:12px;color:#666;line-height:1.6;">
        This is a transactional email sent for account security.<br/>
        Questions? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#4CAF50;text-decoration:none;">${SUPPORT_EMAIL}</a><br/>
        &copy; ${year} Humaeli Global Pvt Ltd | Bhopal, Madhya Pradesh, India
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Humaeli Global Pvt Ltd\n\nReset Your Password\n\nWe received a request to reset the password for your Humaeli account.\n\nClick the link below to reset your password:\n${resetUrl}\n\nThis link is valid for 10 minutes.\n\nIf you did not request a password reset, please ignore this email.\n\nQuestions? Contact us at ${SUPPORT_EMAIL}\n\n© ${year} Humaeli Global Pvt Ltd | Bhopal, Madhya Pradesh, India`;

  const data = await sendTransactionalEmail({
    to: email,
    subject: "Reset your Humaeli password",
    html,
    text,
  });

  console.log(
    `✅ Password reset email sent via ${data?.provider || "mail provider"}:`,
    data?.messageId,
  );
  return data;
};
