Emergency appointment booking
=============================

The existing authenticated POST /api/appointments endpoint accepts
priority: "emergency" and emergency_reason (10–1000 characters). Omitting priority
retains regular booking behavior. Only patient accounts can book; the patient ID
always comes from the authenticated session.

Emergency requests require a doctor, an owned clinic, and a reason. They do not
require a date, time slot, token selection, availability, or payment selection.
The server records the request timestamp and India calendar date, leaving the
appointment time, slot key and token null. Regular booking still uses availability
and slot capacity checks. An unscheduled emergency does not consume a normal slot.
Repeated active requests by the same patient at the same clinic/doctor on the
same day return 409; a clinic lock prevents concurrent duplicates.

Requests remain pending for the clinic to confirm. They appear with an Emergency
label and reason in patient history and the doctor's appointment list/details.
The doctor and active clinic-assigned nurse, receptionist, assistant, manager and
supervisor accounts receive stored notifications and live socket alerts. Device
push uses each recipient's registered FCM token when available. Other doctors'
staff, other clinics and inactive staff are excluded. Notification failures do
not roll back a saved request; existing notification delivery logs report them.
queueUpdated events refresh token
status. The existing queue places emergency appointments ahead of regular waiting
appointments without interrupting a consultation already in progress. Other
patients' token responses do not include emergency reasons.

Run `npm run migrate:emergency-appointments` before deployment when schema updates
use a separate database account. The same idempotent schema check runs on the
first emergency request, adding priority and emergency_reason when missing and
allowing null appointment_time, token_number and slot_key for unscheduled requests.
The clinic-staff migration is also checked before looking up notification recipients.
Existing priority ENUM columns that cannot store emergency are widened to VARCHAR.

Focused checks:
node node_modules/mocha/bin/mocha.js --timeout 10000 --exit test/emergencyAppointments.test.js test/appointmentSlots.test.js test/tokenStatus.test.js
