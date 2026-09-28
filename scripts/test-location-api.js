import connectDB from "../src/config/db.js";
// One-shot script to:
// 1. Reactivate a known session in MongoDB (so the existing JWT works again)
// 2. Hit all 4 location endpoints and print results
//
// Run with:  node --env-file=.env scripts/test-location-api.js
//
// This script is intentionally simple — no test framework, just curl-style calls.

import mongoose from "../src/persistence/mongoose.js";

const SESSION_ID = "6a0c34574a5c1a4cd4ca8038";
const USER_ID = "69d8985fc296c4c74d1d8975";
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OWQ4OTg1ZmMyOTZjNGM3NGQxZDg5NzUiLCJzZXNzaW9uSWQiOiI2YTBjMzQ1NzRhNWMxYTRjZDRjYTgwMzgiLCJyb2xlIjoiY291bnNlbGxvciIsImlhdCI6MTc3OTE4NDcyNywiZXhwIjoxNzgwNDgwNzI3fQ.GutpFrStTmrcEiIowN2OiRwYE3UyiYOQH4bOeH5bndI";

const BASE = "http://localhost:5000";

const log = (label, data) => {
  console.log(`\n━━━ ${label} ━━━`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
};

const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed;
  try {
    parsed = await res.json();
  } catch {
    parsed = await res.text();
  }
  return { status: res.status, body: parsed };
};

async function main() {
  // 1. Connect to Mongo & reactivate the session
  await connectDB();

  const result = await mongoose.connection.db.collection("sessions").updateOne(
    { _id: new mongoose.Types.ObjectId(SESSION_ID) },
    { $set: { isActive: true } },
  );
  log("Session reactivation", {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });

  // Also check what's actually there
  const doc = await mongoose.connection.db
    .collection("sessions")
    .findOne({ _id: new mongoose.Types.ObjectId(SESSION_ID) });
  log("Session doc after update", doc);

  if (!doc) {
    console.log(
      "\n⚠️  Session does not exist in DB. You must log in fresh via POST /api/auth/login to get a working token.",
    );
    await mongoose.disconnect();
    return;
  }

  // 2. Test endpoint: POST /api/location/update
  log(
    "TEST 1 — POST /api/location/update (Mumbai coords)",
    await call("POST", "/api/location/update", {
      latitude: 19.076,
      longitude: 72.8777,
      event: "login",
    }),
  );

  // 3. Test endpoint: POST /api/location/update (invalid coords)
  log(
    "TEST 2 — POST /api/location/update (invalid lat)",
    await call("POST", "/api/location/update", {
      latitude: 200,
      longitude: 72.8777,
    }),
  );

  // 4. Test endpoint: POST /api/location/update (missing body)
  log(
    "TEST 3 — POST /api/location/update (missing fields)",
    await call("POST", "/api/location/update", {}),
  );

  // 5. Test endpoint: GET /api/location/counsellors/nearby
  log(
    "TEST 4 — GET /api/location/counsellors/nearby (around Mumbai, 25km)",
    await call(
      "GET",
      "/api/location/counsellors/nearby?lat=19.076&lng=72.8777&radiusKm=25",
    ),
  );

  // 6. Test endpoint: GET /api/location/counsellors/nearby (no params, uses caller's saved loc)
  log(
    "TEST 5 — GET /api/location/counsellors/nearby (no params, uses my saved loc)",
    await call("GET", "/api/location/counsellors/nearby"),
  );

  // 7. Test endpoint: GET /api/location/admin/pending
  //    User is a counsellor not admin → expect 403
  log(
    "TEST 6 — GET /api/location/admin/pending (as counsellor → expect 403)",
    await call("GET", "/api/location/admin/pending"),
  );

  // 8. Test endpoint: POST /api/location/admin/:userId/verify (also 403)
  log(
    "TEST 7 — POST /api/location/admin/<id>/verify (as counsellor → expect 403)",
    await call("POST", `/api/location/admin/${USER_ID}/verify`, {
      approve: true,
      notes: "admin test",
    }),
  );

  // 9. Verify the user document was updated
  const user = await mongoose.connection.db
    .collection("users")
    .findOne(
      { _id: new mongoose.Types.ObjectId(USER_ID) },
      { projection: { fullName: 1, role: 1, location: 1, locationData: 1, locationConsent: 1 } },
    );
  log("User doc after location updates", user);

  await mongoose.disconnect();
  console.log("\n✅ All tests completed.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
