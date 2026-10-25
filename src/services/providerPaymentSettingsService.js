import { fail } from '../utils/clinicAccess.js';
import { feeCurrency } from '../utils/consultationCurrency.js';

export const providerRoles = ['doctor', 'counsellor', 'counselor', 'consultant', 'counsellour'];
export const supportedPaymentMethods = ['credit_card', 'debit_card', 'upi', 'cash', 'insurance'];
export const expandPaymentMethods = (methods = ['cash']) => [...new Set(methods.flatMap((method) =>
  method === 'online' ? ['credit_card', 'debit_card'] : supportedPaymentMethods.includes(method) ? [method] : []))];

export function validateProviderPaymentSettings(body = {}) {
  if (!Array.isArray(body.methods) || !body.methods.length || body.methods.some((method) => !supportedPaymentMethods.includes(method))) {
    throw fail(400, 'Select at least one valid payment method.');
  }
  const bank = body.bankAccount || {};
  const bankAccount = {
    accountHolder: String(bank.accountHolder || '').trim(), bankName: String(bank.bankName || '').trim(),
    accountNumber: String(bank.accountNumber || '').replace(/\s/g, ''), ifscCode: String(bank.ifscCode || '').trim().toUpperCase(),
  };
  const upiId = String(body.upiId || '').trim();
  const upiApp = String(body.upiApp || '');
  if (!['', 'phonepe', 'google_pay', 'paytm', 'bhim', 'other'].includes(upiApp)) throw fail(400, 'Choose a valid UPI app.');
  if (body.methods.some((method) => ['credit_card', 'debit_card'].includes(method)) &&
    (!bankAccount.accountHolder || bankAccount.accountHolder.length > 100 || !bankAccount.bankName || bankAccount.bankName.length > 100 ||
      !/^\d{8,20}$/.test(bankAccount.accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankAccount.ifscCode))) {
    throw fail(400, 'Enter the account holder, bank name, valid account number and IFSC for card payment settlements.');
  }
  if (body.methods.includes('upi') && !/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test(upiId)) {
    throw fail(400, 'Enter a valid receiving UPI ID.');
  }
  return { methods: [...new Set(body.methods)], bankAccount, upiId, upiApp };
}

export function publicPaymentSettings(provider, settings) {
  const currency = feeCurrency(provider) || 'INR';
  const methods = expandPaymentMethods(settings?.methods || provider.acceptedPaymentMethods || ['cash']);
  // Legacy card settings did not save a receiving bank account on the server.
  const available = methods.filter((method) => {
    if (['credit_card', 'debit_card'].includes(method)) return currency === 'INR' && Boolean(settings?.bankAccount?.accountNumber);
    if (method === 'upi') return currency === 'INR' && Boolean(settings?.upiId);
    return true;
  });
  return { methods: available, consultationFee: provider.consultationFee ?? 0, currency };
}
