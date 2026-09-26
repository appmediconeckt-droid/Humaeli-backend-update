Clinic and hospital staff
=========================

Staff belong to the authenticated doctor and one clinic/hospital. POST /api/staff
requires clinic_id. PUT/PATCH /api/staff/:id accepts clinic_id to move a staff
member to another clinic owned by the same doctor. Ownership cannot be changed
through the request body. Staff responses include clinic_id and clinic_name.

GET /api/staff supports clinic_id=<id>, clinic_id=all, and
clinic_id=unassigned. Without a filter, it returns only the signed-in doctor's
staff. Existing records without a clinic remain unassigned; the application does
not guess a location. Assign them using Staff Management > Edit.

Staff routes and clinic write routes require an authenticated doctor/counsellor.
Clinic read routes remain available to the patient booking flow.

The additive schema migration adds nullable clinic_id columns to users,
appointments and walkin_appointments when missing. Run `npm run migrate:clinic-staff` before
deployment if the application database user does not have ALTER permission.
The same idempotent check also runs on first staff use / walk-in creation / clinic
deletion. No existing staff or appointments are reassigned by migration.

New walk-in bookings preserve the clinic selected by the availability slot.
DELETE /api/clinics/:id only deletes an owned clinic without linked staff,
appointment records, or availability timings. A 409 response explains what
prevents deletion. Reassign/remove staff and clear timings first. Clinics with
appointment history are retained to preserve their patient records.

Verification: node node_modules/mocha/bin/mocha.js --timeout 10000 --exit
test/clinicStaff.test.js test/appointmentSlots.test.js
