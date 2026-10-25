import { expect } from "chai";
import {
  getStrongPasswordError,
  isStrongPassword,
  STRONG_PASSWORD_MESSAGE,
} from "../src/utils/passwordPolicy.js";

describe("passwordPolicy", function () {
  it("accepts a password with all required character groups", function () {
    expect(isStrongPassword("Password1!")).to.equal(true);
    expect(getStrongPasswordError("Password1!")).to.equal("");
  });

  it("rejects weak passwords with a consistent message", function () {
    expect(isStrongPassword("password")).to.equal(false);
    expect(getStrongPasswordError("password")).to.equal(STRONG_PASSWORD_MESSAGE);
  });

  it("uses field-specific messages when requested", function () {
    expect(getStrongPasswordError("password", "New password")).to.equal(
      "New password must be 6 to 20 characters and include uppercase, lowercase, number, and special character.",
    );
  });

  it('accepts 6 and 20 characters and rejects 5 and 21 characters', () => {
    for (const length of [5, 6, 20, 21]) {
      const password = 'Aa1!' + 'x'.repeat(length - 4);
      expect(isStrongPassword(password)).to.equal(length >= 6 && length <= 20);
      expect(getStrongPasswordError(password) === '').to.equal(length >= 6 && length <= 20);
    }
  });
});
