import { expect } from "chai";
import {
  ANONYMOUS_USER_NAME,
  getAnonymousUserName,
  sanitizeUserForCounselor,
} from "../src/utils/anonymousUser.js";

describe("anonymousUser privacy helpers", function () {
  it("prefers the stored anonymous handle over a real name", function () {
    const user = {
      fullName: "Real Patient",
      anonymous: "Anonymous_1234",
    };

    expect(getAnonymousUserName(user)).to.equal("Anonymous_1234");
  });

  it("falls back to the generic anonymous label", function () {
    expect(getAnonymousUserName({ fullName: "Real Patient" })).to.equal(
      ANONYMOUS_USER_NAME,
    );
  });

  it("removes direct identity fields before sending user data to counselors", function () {
    const safeUser = sanitizeUserForCounselor({
      _id: "user-1",
      fullName: "Real Patient",
      email: "patient@example.com",
      anonymous: "Anonymous_1234",
      profilePhoto: { url: "https://example.com/patient.jpg" },
      gender: "female",
      age: 28,
      isOnline: true,
    });

    expect(safeUser.name).to.equal("Anonymous_1234");
    expect(safeUser.fullName).to.equal("");
    expect(safeUser.email).to.equal("");
    expect(safeUser.profilePhoto).to.equal(null);
    expect(safeUser.avatar).to.equal(null);
    expect(safeUser.gender).to.equal("female");
    expect(safeUser.age).to.equal(28);
  });
});
