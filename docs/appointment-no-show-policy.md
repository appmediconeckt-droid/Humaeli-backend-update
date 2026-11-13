# Appointment no-show cancellation

Online and walk-in appointments allow arrival for 24 hours after the original
scheduled appointment time (India time). Emergency requests without a scheduled
time allow 24 hours after creation. Queue delays and doctor breaks do not move
this deadline. Future appointments are not timed from their booking date.

The existing once-per-minute backend job checks both appointment collections.
An absent appointment is atomically changed to canceled/cancelled with queue
status canceled, reason NO_SHOW_24_HOURS, cancellation timestamp and deadline.
Its slot is released; existing appointment history is retained. Concurrent
check-in, consultation start and duplicate worker claims are guarded.

A recorded check-in, available/returned patient, or started/completed consultation
prevents automatic cancellation. Staff must record arrival through patient
availability/check-in; physical arrival alone is not observable by the server.
Unpaid checkout drafts are excluded. Existing overdue, unarrived appointments
are eligible on the first minute job after deployment.

Patient cancellation notifications use the existing notification service.
Realtime events refresh doctor/patient screens. The doctor active queue retains
past-date appointments only inside the 24-hour window; stale active API statuses
cannot leave very old appointments on the live dashboard. Daily summary cards
continue to count today's appointments. Staff can record yesterday's arrival
inside the remaining window. Mobile completion metadata (including ended_at and
queueStatus) is reconciled to completed before no-show cancellation is attempted.

Deploy/restart the backend and deploy the updated web frontend. This policy does
not require a new cron service; cancellation happens on the first successful
minute tick at or after the deadline while the backend/database are available.
The job also runs on backend startup to process overdue records promptly.
