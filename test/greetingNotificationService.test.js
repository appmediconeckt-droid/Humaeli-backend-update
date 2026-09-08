import { expect } from "chai";
import { getDueGreetingSlot } from "../src/services/greetingNotificationService.js";

const utcDate = (iso) => new Date(iso);

describe("greetingNotificationService", () => {
  it("returns the two morning greeting slots in Asia/Kolkata", () => {
    expect(
      getDueGreetingSlot(utcDate("2026-09-07T23:30:00.000Z"), "Asia/Kolkata")
        ?.title,
    ).to.equal("Good Morning");
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T04:00:00.000Z"), "Asia/Kolkata")
        ?.slot,
    ).to.equal("09:30");
  });

  it("returns afternoon, evening, and night slots", () => {
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T06:30:00.000Z"), "Asia/Kolkata")
        ?.title,
    ).to.equal("Good Afternoon");
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T13:30:00.000Z"), "Asia/Kolkata")
        ?.title,
    ).to.equal("Good Evening");
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T15:30:00.000Z"), "Asia/Kolkata")
        ?.title,
    ).to.equal("Good Night");
  });

  it("does not return a greeting outside the exact send minute", () => {
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T00:01:00.000Z"), "Asia/Kolkata"),
    ).to.equal(null);
  });
});
