# Doctor profile and clinic walk-in QR

Set Railway backend `PUBLIC_APP_URL=https://humaeli.com` (the actual **frontend** origin).
Deploy both backend and frontend. The frontend host must serve index.html for
`/doctor/*` and `/walkin/*`, as for other React routes. Existing MySQL startup
creates the additional tables; no manual removal of existing tables or indexes is required.

## Patient links

- `/doctor/:doctorId`: permanent public profile, current clinic list and timings.
- `/walkin/:doctorClinicId`: today's walk-in form locked to its doctor and clinic.
- Existing `/walk-in-appointment?doctorId=...&source=qr` links lead to the profile
  so the patient can choose a clinic. Existing snapshot profile links still render.

Doctor registration now encodes the permanent profile URL in `doctorQrCode`,
and stores `profileQrUrl` and `doctorQrType`. Existing saved `doctorQrCode` data
is retained; management pages use the canonical `profileQrCode` image instead.
Previously printed images containing snapshots/JSON cannot be rewritten remotely.

## API

- `GET /api/qr/doctors/:doctorId/profile`: public doctor details and clinics.
- `GET /api/qr/doctors/:doctorId/codes`: authenticated doctor/admin/authorized
  staff; profile QR PNG and clinic QR PNGs, as data URLs.
- `GET /api/qr/walkin/:doctorClinicId`: public fixed clinic/doctor and timings.
- `POST /api/qr/walkin/:doctorClinicId`: `patientName`, `phoneNumber`, `symptoms`,
  `requestId` (random 8–64 character identifier, reused on retries).

Clinic creation and doctor-facility mapping automatically return `doctorClinicId`,
`doctorId`, `clinicId`, `facilityId`, `qrType: CLINIC_WALKIN`, `walkinQrUrl` and
`walkinQrCode`. A facility-only mapping has a null legacy `clinicId`; its facility
is still fixed. Editing a clinic preserves its link. Existing clinics are
idempotently backfilled when profile/management codes are requested.

Clinic creation displays its downloadable QR immediately. The QR Code menu uses
`GET /api/qr/doctors/:doctorId/clinics` and a clinic dropdown to show only the selected
clinic QR, with an Open LED display button. The Clinic Page has no extra QR list.
The doctor profile QR remains available separately in profile settings.
Use the **same facilityId and doctorId** in LED display configuration to display
that clinic queue. The LED browser route remains `/display/:displayId` on backend.

Appointments and queue rows are committed in one transaction. Tokens are serialized
per facility, doctor and day; the default day timezone is Asia/Kolkata. A repeated
requestId returns the same token. An active duplicate patient phone in the same
queue is rejected. Inactive mappings/QRs, deleted clinics and inactive doctors
cannot accept QR bookings. Profile clinic selection currently books today's walk-in;
the existing scheduled appointment APIs remain separate.

## Validation

`test/clinicQr.mysql.test.js` is opt-in (`QR_MYSQL_TEST=1`), local MySQL only, with
an isolated database name matching `humaeli_test_qr_*`. It covers stable distinct
QRs, queue isolation, concurrent tokens, retry deduplication, HTTP access control,
atomic rollback and inactive/deleted clinics. Never point it at production.
