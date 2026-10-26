import { expect } from 'chai';
import { normalizeStaffPhone } from '../src/utils/staffPhone.js';
import { staffPhoneCountries } from '../src/utils/staffPhoneCountries.js';

describe('Staff country phone validation', () => {
  it('requires ten national digits for India and stores the country code', () => {
    expect(normalizeStaffPhone('9876543210', '+91', 'IN').phoneNumber).to.equal('+919876543210');
    for (const value of ['987654321', '98765432101', '98765abc10']) {
      expect(() => normalizeStaffPhone(value, '+91', 'IN')).to.throw();
    }
  });
  it('accepts international input and rejects mismatched country selections', () => {
    expect(normalizeStaffPhone('+971 50 123 4567', '+971', 'AE').phoneNumber).to.equal('+971501234567');
    expect(() => normalizeStaffPhone('9876543210', '+1', 'IN')).to.throw();
  });
  it('checks country lengths including countries that share calling codes', () => {
    for (const country of staffPhoneCountries) {
      for (const length of country.lengths) {
        if (length + country.dial.length - 1 > 15) continue;
        expect(normalizeStaffPhone('5'.repeat(length), country.dial, country.iso).phoneCountryCode).to.equal(country.dial);
      }
      expect(() => normalizeStaffPhone('1', country.dial, country.iso)).to.throw();
      expect(() => normalizeStaffPhone('5'.repeat(Math.max(...country.lengths) + 1), country.dial, country.iso)).to.throw();
    }
  });
});
