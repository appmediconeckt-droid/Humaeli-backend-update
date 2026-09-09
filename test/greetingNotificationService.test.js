import { expect } from "chai";
import {
  getDueGreetingSlot,
  getPendingGreetingSlots,
} from "../src/services/greetingNotificationService.js";

const utcDate = (iso) => new Date(iso);

describe("greetingNotificationService", () => {
  it("returns the two morning greeting slots in Asia/Kolkata", () => {
    expect(
      getDueGreetingSlot(utcDate("2026-09-07T23:30:00.000Z"), "Asia/Kolkata")
        ?.title,
    ).to.equal("Good Morning");
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T01:30:00.000Z"), "Asia/Kolkata")
        ?.slot,
    ).to.equal("07:00");
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

  it("spaces the second greeting two hours after the first slot", () => {
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T08:30:00.000Z"), "Asia/Kolkata")
        ?.slot,
    ).to.equal("14:00");
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T11:30:00.000Z"), "Asia/Kolkata")
        ?.slot,
    ).to.equal("17:00");
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T13:30:00.000Z"), "Asia/Kolkata")
        ?.slot,
    ).to.equal("19:00");
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T17:30:00.000Z"), "Asia/Kolkata")
        ?.slot,
    ).to.equal("23:00");
  });

  it("does not return a greeting outside the exact send minute", () => {
    expect(
      getDueGreetingSlot(utcDate("2026-09-08T00:01:00.000Z"), "Asia/Kolkata"),
    ).to.equal(null);
  });

  it("catches up a missed morning push while the morning window is still fresh", () => {
    const slots = getPendingGreetingSlots(
      utcDate("2026-09-08T00:15:00.000Z"),
      { timeZone: "Asia/Kolkata" },
    );

    expect(slots.map((slot) => slot.key)).to.deep.equal([
      "2026-09-08:morning:05:00",
    ]);
  });

  it("uses the latest due slot instead of sending multiple stale greetings together", () => {
    const slots = getPendingGreetingSlots(
      utcDate("2026-09-08T01:30:00.000Z"),
      { timeZone: "Asia/Kolkata" },
    );

    expect(slots.map((slot) => slot.key)).to.deep.equal([
      "2026-09-08:morning:07:00",
    ]);
  });

  it("does not catch up stale greeting slots after the catch-up window", () => {
    const slots = getPendingGreetingSlots(
      utcDate("2026-09-08T05:31:00.000Z"),
      { timeZone: "Asia/Kolkata" },
    );

    expect(slots).to.deep.equal([]);
  });
});
