# Clinic features on the Mongoose/MySQL backend

All feature controllers use Mongoose models through `src/persistence/mongoose.js`.
The custom driver stores model fields in MySQL columns. There is no second SQL
pool or legacy integer-ID user table. Use the string `_id` returned by signup;
never convert doctor, patient, appointment, clinic or staff IDs to numbers.

## Setup

Run `npm install`, then `npm run db:setup`. This creates missing model tables and
adds missing columns through the existing storage driver. It does not delete
application records. `npm run db:verify-schema` compares the database to all
registered models. Normal server startup performs the same model synchronization.

New collections: `clinics`, `date_ranges`, `unavailable_dates`,
`walkin_appointments`, `follow_ups`, `leaves`, `medications`, `doctor_breaks`,
`doctor_analytics_events`, `appointment_counters`.

`users` gains `assignedDoctor` and `staffCertifications`. The existing
`certifications` array continues to hold professional certification documents.
Appointments retain `patient`, `counselor`, `date`, `status` and add clinic,
token, booking-source, check-in, notes and slot-uniqueness fields. `counselor`
can reference a doctor or counsellor; the account role remains `doctor` for doctors.

## Authorization and staff

Send the login access token as `Authorization: Bearer <token>`.
`POST /api/staff` creates a staff account for the logged-in doctor. Required:
`fullName`, `email`, `phoneNumber`, `password`, `role`. Supported roles:
`nurse`, `assistant`, `lab_technician`, `housekeeping`, `supervisor`,
`department_manager`, `billing`. The password must satisfy the existing policy.
Camel-case fields and their snake-case aliases (for example `staffId` / `staff_id`)
are accepted for staff details. Admin callers supply `doctor_id`.

`GET /api/staff`, `PATCH /api/staff/:id`, `DELETE /api/staff/:id` list, edit, or
deactivate staff belonging to that doctor. Deactivation also closes their sessions.
The create response never includes the password. Staff sign in through the existing
email/password login. Manager-created accounts are not marked email/phone verified.
Self-registered staff have no doctor assignment and cannot access a clinic's records
until an authorized assignment workflow exists; existing accounts are not silently claimed.

## Clinics and availability

- `/api/clinics`: GET public list, POST doctor/admin create.
- `/api/clinics/:id`: GET public detail, PATCH/DELETE owner doctor/admin.
- Clinic fields: `clinic_name`, `phone_number`, `location`; multipart `clinic_photo` optional.
- `/api/availability/ranges`: authenticated GET/POST; PUT/DELETE `/:id`.
- Range fields: `clinic_id`, either `date` (`YYYY-MM-DD`) or `weekday` (Sunday=0),
  `start_time`, `end_time` (`HH:mm`), `slot_duration` (minutes), `is_unavailable`.
- Populate the clinic selector using `GET /api/clinics?doctor_id=<doctor id>`.
  Use each result's `id`/`_id` as the option value, never `index + 1` or a hardcoded
  `1`. If the list is empty, create a clinic with `POST /api/clinics`; use the
  returned `clinicId` for range creation. Reads can omit `clinic_id` to list all
  ranges for the authorized doctor. Invalid IDs return `INVALID_CLINIC_ID`;
  a valid ID belonging to a different doctor is not accepted.
- `/api/availability/available?doctor_id=<id>`: public available schedule.
- POST `/api/availability/unavailable` with `date`; DELETE `/clear-date` with
  `date`; DELETE `/clear-all`. Writes are always limited to the authenticated doctor
  or their assigned permitted staff, including clearing unavailable dates.

## Appointments

`POST /api/appointments` (also `/book`) accepts the existing
`counselorId`, `date` (ISO date-time), `notes`. It also accepts `doctor_id`,
`appointment_date` and `appointment_time` (interpreted in India time).
Optional `clinic_id` enforces the clinic's date-specific or weekly availability.
Patients book for themselves. Doctors/assigned nurses/assistants additionally send
`patient_id` to book for an existing active patient. The professional must have a
completed profile. Unavailable dates and duplicate occupied slots are rejected.

`GET /api/appointments` preserves the existing patient/doctor list. `/all`, `/today`,
`/:id` and `/patient/:patientId` provide scoped clinic views. PATCH `/:id/status`
supports the existing lifecycle; PATCH `/:id/check-in` accepts nurse vitals;
PATCH `/:id` edits clinical notes/status. DELETE `/:id` is doctor/admin only.
Patients, doctors and staff cannot read another doctor's records.

Tokens for scheduled and walk-in appointments come from the doctor's availability
slots for the selected India calendar date. For example, with 15-minute slots,
10:00 is token 1 and 10:15 is token 2. Each separate availability range starts
again at token 1, so 10:00-14:00 and 18:00-22:00 both begin with token 1.
Date-specific availability overrides weekly ranges.

## Walk-ins, follow-ups, leaves, medications

- Public, rate-limited POST `/api/walkin-appointments`: `doctor_id`, `patient_name`,
  `phone_number`, `symptoms`; optional `gender`, `date_of_birth`, `booking_source` (`qr`/`direct`).
  Stores an intake record, not a login account. It never marks a phone verified or
  overwrites an existing patient's profile based on an unverified phone number.
  GET list/detail, PATCH and DELETE require the assigned doctor/staff.
- PATCH walk-in `/:id` with `follow_up_required: true`, `follow_up_date` creates or
  updates a single linked follow-up. Patient intake names remain available without
  requiring an artificial patient login account.
- `/api/followups`: POST/GET; GET `/today`; GET/PUT/DELETE `/:id`.
  Registered-patient follow-ups require `patient_id`, `follow_up_date`, optionally
  `appointment_id`, `follow_up_time`, `type`, `reason`, `notes`. The patient must
  already be linked to this doctor through an appointment.
- `/api/leaves/apply-leave`: `leave_type`, `start_date`, `end_date`, `reason`.
  `/my-leaves` and DELETE `/cancel-leave/:id` use authenticated identity.
  Doctors/admins use `/all-leaves`, `/pending-leaves`, `/user/:user_id`, and
  PUT `/update-leave-status/:id` (`approved`/`rejected`). Nobody approves their own leave.
- `/api/medications/add-medication`: `medication_name`, `dose`, `timing`, `route`,
  `patient_name`, `room_number`, optional `remarks`. Doctor/admin/assigned nurse only.
  GET `/medications`, `/medication/:id`, `/medications/status/:status`;
  PUT `/update-medication/:id`; PATCH `/update-status/:id` (`pending`/`given`/`missed`);
  DELETE `/delete-medication/:id`.

## Notification URLs

The notification router is mounted at `/api/notifications`. Create with
`POST /api/notifications` and read the authenticated user's feed with
`GET /api/notifications`. Legacy user-specific reads also work at
`GET /api/notifications/:user_id/:user_role` and stats at
`GET /api/notifications/stats/:user_id/:user_role`.
Use PUT `/:id/read` or `/mark-all-read`, POST `/payment` (admin only), and
POST `/reminder` (assigned professional/admin). The old doubled
`/api/notifications/notifications/...` URLs remain supported.

For staff creation use `POST /api/staff` with the doctor access token.
The backend origin must be the same as login; paths are relative to that origin.
An unauthenticated request to these protected routes returns 401, not 404.

## Breaks and analytics

POST `/api/doctor-breaks/start` with `duration_minutes` (1–240) and optional `reason`;
GET `/active`; PATCH `/:breakId/end`. Only the logged-in doctor can operate their
break. The active break is persisted; pending appointment delays are calculated on
read from the original appointment date. Expired breaks close on the next read.
No extra link table or destructive rewriting of scheduled times is needed.

`/api/auth/doctor-qr/:id/scan` records QR scan events; doctor profile reads record
profile views; `/api/auth/doctor-qr/:id/stats` returns stored counts and booking sources.
The QR image itself still contains the registration details snapshot, not a website URL.

## Verification

`npm test` runs normal regression tests without application-database writes.
For real SQL/API checks, set `NODE_ENV=test` and `CLINIC_MYSQL_TEST=1`, then run
`node node_modules/mocha/bin/mocha.js --exit test/clinicMysql.integration.test.js`.
This creates a uniquely named `humaeli_test_clinic_<timestamp>` database and drops
only that database afterward. The database user needs CREATE/DROP DATABASE permissions.

## Duplicate booking protection

Both `POST /api/appointments` and `POST /api/walkin-appointments` check existing
online and walk-in records before saving. Same doctor + patient + IST date +
minute returns HTTP 409 with `code: "DUPLICATE_APPOINTMENT"`. A MySQL advisory
lock serializes concurrent booking requests across server processes. Failed
saves release the lock; old `appointment_slots` reservations are no longer used.
Online appointments retain their existing exclusive doctor/slot constraint.

Online patient identity uses the account ID; public walk-ins use the normalized
phone number, also matched against online patients. Indian local and +91 phone
formats match. Public intake does not create or modify a login account. Patients
sharing one phone are treated as the same walk-in identity for this check.

Walk-in clients may send `appointment_date: "2099-02-01"` and
`appointment_time: "10:30"` together (camelCase aliases also accepted). If omitted,
the current IST date/minute is used. Keep date/time unchanged when retrying a
scheduled submission. Seconds within one minute count as the same booking time.
Canceled/rejected bookings allow rebooking; reactivating an old booking checks for
conflicts again. Existing duplicate records are not deleted by this change.
