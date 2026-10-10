import { sendTransactionalEmail } from './otpService.js';

export const staffWelcomeEmailDelivery = {
  send: sendTransactionalEmail,
  wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export async function sendStaffWelcomeEmail({ email, fullName, password }) {
  const mail = {
    to: email,
    subject: 'Your Humaeli staff account and temporary password',
    text: `Hello ${fullName || 'Staff member'},\n\nYour doctor has created your Humaeli staff account.\n\nLogin email: ${email}\nTemporary password: ${password}\n\nSign in with these details. You can change your password in Settings after signing in. Keep this password private.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#183247;max-width:600px;padding:24px"><h2>Welcome to Humaeli</h2><p>Hello ${escapeHtml(fullName || 'Staff member')},</p><p>Your doctor has created your Humaeli staff account.</p><p><strong>Login email:</strong> ${escapeHtml(email)}<br><strong>Temporary password:</strong> ${escapeHtml(password)}</p><p>Sign in with these details. You can change your password in <strong>Settings</strong> after signing in.</p><p>Keep this password private.</p></div>`,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await staffWelcomeEmailDelivery.send(mail);
      // SMTP can resolve even when the recipient was rejected. Do not report
      // successful delivery merely because sendMail returned an object.
      if (Array.isArray(result?.accepted) && !result.accepted.some(address =>
        String(typeof address === 'object' ? address.address : address).toLowerCase() === email.toLowerCase())) {
        throw Object.assign(new Error('Staff recipient was rejected by the mail server'), { code: 'STAFF_EMAIL_REJECTED', nonRetryable: true });
      }
      return result;
    } catch (error) {
      const status = Number(error.status);
      const permanent = error.nonRetryable || ['EAUTH', 'STAFF_EMAIL_REJECTED'].includes(error.code) ||
        (status >= 400 && status < 500 && status !== 408 && status !== 429) || Number(error.responseCode) >= 500;
      if (permanent || attempt === 2) throw error;
      await staffWelcomeEmailDelivery.wait(500 * (attempt + 1));
    }
  }
}
