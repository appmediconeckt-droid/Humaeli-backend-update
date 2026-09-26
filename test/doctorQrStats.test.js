import { expect } from "chai";
import sinon from "sinon";
import { createDoctorQrStatsService } from "../src/services/doctorQrStatsService.js";

describe("Doctor QR statistics", () => {
  it("returns real zero counts without fabricated minimums", async () => {
    const query = sinon.stub();
    query.onCall(0).resolves([]);
    query.onCall(1).resolves([[{ todayScans: 0, thisWeekScans: 0, profileViews: 0 }]]);
    query.onCall(2).resolves([[{ count: 0 }]]);
    expect(await createDoctorQrStatsService(query).getStats("doctor-1")).to.deep.equal({
      todayScans: 0, thisWeekScans: 0, qrAppointments: 0, profileViews: 0,
    });
  });

  it("uses India midnight and Monday week boundaries and only QR bookings", async () => {
    const query = sinon.stub();
    query.onCall(0).resolves([]);
    query.onCall(1).resolves([[{ todayScans: "2", thisWeekScans: "7", profileViews: "12" }]]);
    query.onCall(2).resolves([[{ count: "3" }]]);
    const stats = await createDoctorQrStatsService(query).getStats("doctor-2", new Date("2026-09-27T19:00:00Z"));
    expect(query.secondCall.args[1]).to.deep.equal([
      "2026-09-27 18:30:00", "2026-09-28 18:30:00",
      "2026-09-27 18:30:00", "2026-10-04 18:30:00", "doctor-2",
    ]);
    expect(query.thirdCall.args[0]).to.include("booking_source = 'qr'");
    expect(query.thirdCall.args[1]).to.deep.equal(["doctor-2"]);
    expect(stats).to.deep.equal({ todayScans: 2, thisWeekScans: 7, qrAppointments: 3, profileViews: 12 });
  });

  it("deduplicates visit IDs in the database and initializes storage once", async () => {
    const query = sinon.stub().resolves([]);
    const service = createDoctorQrStatsService(query);
    await service.recordVisit("doctor-1", "same-visit", true);
    await service.recordVisit("doctor-1", "same-visit", true);
    expect(query.callCount).to.equal(3);
    expect(query.firstCall.args[0]).to.include("PRIMARY KEY (doctor_id, visit_id)");
    expect(query.secondCall.args[0]).to.include("INSERT IGNORE");
    expect(query.secondCall.args[1]).to.deep.equal(["doctor-1", "same-visit", 1]);
  });

  it("propagates database failures instead of reporting zero", async () => {
    const query = sinon.stub();
    query.onCall(0).resolves([]);
    query.onCall(1).rejects(new Error("database unavailable"));
    query.onCall(2).resolves([[{ count: 0 }]]);
    try {
      await createDoctorQrStatsService(query).getStats("doctor-1");
      expect.fail("Expected database error");
    } catch (error) {
      expect(error.message).to.equal("database unavailable");
    }
  });
});
