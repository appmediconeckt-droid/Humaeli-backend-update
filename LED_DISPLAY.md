# Doctor-wise LED display

## Clinic QR menu display

### LED connected to the doctor's laptop

Connect the outside screen with HDMI. On Windows choose **Win + P → Extend**.
In QR Code, select the clinic, enter its doctor room number and click Save.
Click **Open separate LED window**, focus that new browser window, and press
**Win + Shift + Left/Right Arrow** to move it to the outside display. Press F11
there for full screen. The dashboard stays on the laptop. Keep the laptop awake,
the browser window open and the network connected. Browsers do not automatically
choose an external screen; this placement is a one-time manual step.

Room configuration uses authenticated `PATCH /api/qr/walkin/:doctorClinicId/room`
with `{ "roomNumber": "101" }`. Only the owning doctor, authorized assigned staff,
or admin can change it. Each doctor/clinic mapping has its own room. Existing QR
and LED links stay the same, and the LED picks up room changes on its next refresh.

In the doctor QR Code menu, choose a clinic and click **Open LED display** or
**Copy LED link**. No separate display configuration is required for this link:

```text
https://YOUR-BACKEND-DOMAIN/display/clinic/DOCTOR_CLINIC_ID
```

Its public JSON endpoint is `GET /api/qr/walkin/DOCTOR_CLINIC_ID/queue`.
Use the relationship's `doctorClinicId`, not the legacy `clinicId` or doctor ID.
The authenticated dropdown API `GET /api/qr/doctors/DOCTOR_ID/clinics` returns each
clinic's QR image, appointment link and `ledPath`. It does not generate a doctor
profile QR. The LED resolves that same relationship and filters by both doctor
and facility, so another clinic's tokens cannot appear. Deleted clinics or
inactive mappings stop serving the queue. Refresh is every three seconds.

Clinic displays combine today's scheduled dashboard appointments for the selected
clinic, clinic-linked walk-ins and reception/QR check-ins. A linked appointment is
counted once. Scheduled appointment status changes are read on every refresh.
Appointments with no clinic assignment are not guessed into another clinic's LED;
other dates and clinics are excluded. Existing token numbers are preserved.
Reception check-ins must use the same facilityId and doctorId. The current token
appears when called or in consultation; waiting entries appear under next tokens.

## Existing configurable displays

Open the browser page on the **backend domain**:

```text
https://YOUR-BACKEND-DOMAIN/display/DISPLAY_ID
```

The page shows the configured doctor's name, room, current token, next tokens,
waiting count, completed count and total patients. It fetches the queue every
3 seconds without needing a doctor login on the TV. This is periodic refresh,
not a Socket.IO subscription. A Full screen button is included. If the connection
fails, the page marks old data as stale, retries automatically and clears tokens
after 60 seconds without fresh data. Disabled/missing displays clear immediately.
Patient names and phone numbers are not returned by the display queue API.

## Configure a doctor display

Use an existing facility and its doctor mapping. With a doctor/admin access token:

```http
POST /api/displays
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "facilityId": "YOUR_FACILITY_ID",
  "doctorId": "YOUR_DOCTOR_ID",
  "displayType": "doctor",
  "name": "Doctor reception LED"
}
```

The response includes `display.id` and `displayUrl`, for example
`/display/abc123`. Append `displayUrl` to your backend domain and open it on the TV.
`DISPLAY_ID` is the display record's ID, **not the doctor ID**.

Existing displays: `GET /api/displays/facility/FACILITY_ID`.
Display JSON data: `GET /api/displays/DISPLAY_ID/queue`.
Do not open the JSON endpoint as the TV page.

Patients enter the queue through clinic QR booking or `/api/queue/check-in`;
other scheduled appointments alone do not populate `queue_entries`.
Department, floor, hospital and reception displays are supported by the same page.
The default queue day is Asia/Kolkata. Set `QUEUE_TIMEZONE` to another valid IANA
timezone only if your facility needs it.

## Deployment

Deploy the changed backend, including the new `src/public/led` assets and queue
route/controller/model files. Run `npm install` from its package.json, then
`npm start`. No frontend deployment is needed for this page. Queue tables are
created during database initialization. Queue and main storage now use the same
Railway variable aliases / MYSQL_URL configuration.

These changes do not deploy themselves. A DATABASE_UNAVAILABLE response still
requires successful database startup; the TV page will show that state and retry.

## Verification

`node node_modules/mocha/bin/mocha.js --exit test/ledDisplay.test.js`

The opt-in `test/ledDisplay.mysql.test.js` uses an isolated, newly created local
MySQL database. It requires LED_MYSQL_TEST=1, MYSQL_HOST=127.0.0.1,
MYSQL_DATABASE=humaeli_test_led_<unique_suffix>, and local root credentials.
It checks doctor isolation, public payload privacy, room/counts, updated queue
data, department/floor/hospital views, disabled displays and protected writes.
It removes only the test database it successfully created.
