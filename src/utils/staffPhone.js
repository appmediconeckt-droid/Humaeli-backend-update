import { staffPhoneCountries } from './staffPhoneCountries.js';

export function normalizeStaffPhone(value, dial = '+91', iso) {
  const country = iso
    ? staffPhoneCountries.find(country => country.iso === iso && country.dial === dial)
    : staffPhoneCountries.find(country => country.dial === dial);
  if (!country) throw new Error('Please select a valid phone country code');
  const raw = String(value || '').trim().replace(/[\s()-]/g, '');
  const local = raw.startsWith(dial) ? raw.slice(dial.length) : raw;
  const lengths = iso ? country.lengths : [...new Set(staffPhoneCountries.filter(item => item.dial === dial).flatMap(item => item.lengths))];
  if (!/^\d+$/.test(local) || !lengths.includes(local.length) || local.length + dial.length - 1 > 15) {
    throw new Error(`Enter ${lengths.join(' or ')} digits after ${dial}`);
  }
  return { phoneNumber: `${dial}${local}`, phoneCountryCode: dial };
}
