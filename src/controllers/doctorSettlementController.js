import Settings from '../models/providerPaymentSettingsModel.js';
import User from '../models/userModel.js';
import { paymentMode, payoutBankFields } from '../services/paymentEnvironment.js';
import { withAppointmentPaymentLock } from '../services/appointmentPaymentService.js';
import { actorId, handle, fail } from '../utils/clinicAccess.js';
import { bankFingerprint, settlementGateway, settleDoctorPayment } from '../services/doctorSettlementService.js';
import { emitResourceUpdated } from '../services/portalRealtimeService.js';

// Only a platform administrator can associate a reviewed bank beneficiary.
export const linkDoctorPayoutBank = handle(async (req, res) => {
  if (req.user.role !== 'admin') throw fail(403, 'Platform admin required.');
  const id = String(req.body?.fundAccountId || '');
  if (!/^fa_[a-zA-Z0-9]+$/.test(id)) throw fail(400, 'A RazorpayX bank fund account is required.');
  const settings = await Settings.findOne({ providerId: req.params.providerId });
  if (!settings?.bankAccount?.accountNumber) throw fail(409, 'Doctor must save receiving bank details first.');
  const fund = await settlementGateway.request(`fund_accounts/${id}`);
  const bank = settings.bankAccount;
  if (fund.active !== true || fund.account_type !== 'bank_account' || String(fund.bank_account?.account_number) !== bank.accountNumber || fund.bank_account?.ifsc !== bank.ifscCode || fund.bank_account?.name?.trim().toLowerCase() !== bank.accountHolder.trim().toLowerCase()) throw fail(409, 'Fund account does not match the saved receiving bank account.');
  const fields = payoutBankFields();
  await Settings.updateOne({ providerId: req.params.providerId }, { $set: { [fields.id]: id, [fields.fingerprint]: bankFingerprint(bank), [fields.key]: process.env.RAZORPAYX_KEY_ID } });
  res.json({ success: true });
});

// This convenience action can never create or verify a live beneficiary.
export const setupDoctorTestBank = handle(async (req, res) => {
  if (req.user.role !== 'doctor') throw fail(403, 'Doctor account required.');
  if (paymentMode() !== 'test') throw fail(403, 'Test bank setup is unavailable in live mode.');
  const providerId = actorId(req);
  await withAppointmentPaymentLock(`test-bank:${providerId}`, async () => {
    const fields = payoutBankFields();
    const settings = await Settings.findOne({ providerId }).select(`+${fields.id} +${fields.fingerprint} +${fields.key}`);
    const bank = settings?.bankAccount;
    if (!bank?.accountNumber || !bank.accountHolder || !bank.ifscCode) throw fail(409, 'Save receiving bank details in Settings → Payment first. Test mode accepts a test beneficiary.');
    if (settings[fields.id] && settings[fields.fingerprint] === bankFingerprint(bank) && settings[fields.key] === process.env.RAZORPAYX_KEY_ID) return;
    const provider = await User.findById(providerId);
    const contact = await settlementGateway.request('contacts', { name: bank.accountHolder, type: 'vendor', reference_id: String(providerId), ...(provider?.email ? { email: provider.email } : {}) });
    if (!contact?.id) throw fail(502, 'Test payout contact could not be confirmed.');
    const fund = await settlementGateway.request('fund_accounts', { contact_id: contact.id, account_type: 'bank_account', bank_account: { name: bank.accountHolder, ifsc: bank.ifscCode, account_number: bank.accountNumber } });
    if (!fund?.id || fund.account_type !== 'bank_account' || fund.active === false) throw fail(502, 'Test bank beneficiary could not be confirmed.');
    await Settings.updateOne({ providerId }, { $set: { [fields.id]: fund.id, [fields.fingerprint]: bankFingerprint(bank), [fields.key]: process.env.RAZORPAYX_KEY_ID } });
  });
  emitResourceUpdated('wallet', [providerId]);
  res.json({ success: true, mode: 'test', message: 'Test bank beneficiary is ready. No real bank verification or transfer was performed.' });
});

export const requestDoctorSettlement = handle(async (req, res) => {
  if (req.user.role !== 'doctor') throw fail(403, 'Doctor account required.');
  const result = await settleDoctorPayment(req.params.paymentId, actorId(req), req.body?.checkOnly === true);
  emitResourceUpdated('wallet', [actorId(req)]);
  res.json({ success: true, ...result });
});
