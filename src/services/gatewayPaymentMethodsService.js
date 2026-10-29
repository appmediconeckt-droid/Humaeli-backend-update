import { paymentMode } from './paymentEnvironment.js';
import { fail } from '../utils/clinicAccess.js';

export const gatewayMethodsRepository = {
  async fetch(keyId) {
    const response = await fetch(`https://api.razorpay.com/v1/methods?key_id=${encodeURIComponent(keyId)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw fail(503, 'Razorpay payment availability could not be checked. Please retry.');
    const data = await response.json();
    if (data.entity !== 'methods' || typeof data.upi !== 'boolean') throw fail(503, 'Razorpay returned invalid payment availability. Please retry.');
    return data;
  },
};

let cache;
export function clearGatewayMethodsCache() { cache = undefined; }
async function methodsForCurrentKey() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) throw fail(503, 'Razorpay payment credentials are not configured.');
  if (cache?.keyId === keyId && cache.expires > Date.now()) return cache.promise;
  const entry = { keyId, expires: Date.now() + 30000 };
  entry.promise = gatewayMethodsRepository.fetch(keyId).catch(error => {
    if (cache === entry) cache = undefined;
    throw error;
  });
  cache = entry;
  return entry.promise;
}

export async function requireGatewayUpi() {
  const methods = await methodsForCurrentKey();
  // Intent/QR live flows do not make the test UPI collect flow available.
  const available = methods.upi === true || (paymentMode() === 'live' && methods.upi_intent === true);
  if (!available) throw fail(409, `UPI is not available for this Razorpay ${paymentMode()} account. Enable UPI for this environment in Razorpay Dashboard or choose a card payment.`);
}

export async function withGatewayUpiAvailability(options) {
  if (!options.methods.includes('upi')) return options;
  try {
    await requireGatewayUpi();
    return options;
  } catch (error) {
    return { ...options, methods: options.methods.filter(method => method !== 'upi'),
      unavailableMethods: { ...options.unavailableMethods, upi: error.message } };
  }
}
