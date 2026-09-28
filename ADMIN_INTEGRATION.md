# Combined admin and chatbot backend

Run this project (`update-code(11-09-26)`) with `npm install` and `npm start`.
Both APIs share its MongoDB connection and HTTP port. The original admin source directory is retained as a reference.

Admin endpoints use `/api/admin/...`; the chatbot notification and location endpoints retain `/api/notifications` and `/api/location`. Point the admin frontend at this server and retain its `/api/admin` route prefix.

Configure `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` (bcrypt), and a separate `ADMIN_JWT_SECRET` in the merged deployment environment. Include the admin frontend origin in `FRONTEND_URL` or `CORS_ORIGINS`. Existing chatbot environment settings remain required. `DOTENV_PATH`, if set, is loaded before the app and used by admin password changes; password changes require a writable environment file. The local ADMIN_EMAIL and ADMIN_PASSWORD_HASH were restored from the original admin src/.env; the merged ADMIN_JWT_SECRET was preserved.

Scheduled notification rules start after MongoDB connects, only when `NOTIFICATION_RULE_SCHEDULER_ENABLED=true`. `NOTIFICATION_RULE_SCHEDULER_DRY_RUN` defaults to `true`; set it to `false` to deliver. Optional interval: `NOTIFICATION_RULE_SCHEDULER_INTERVAL_MS`. The internal rule-list endpoint retains its `ADMIN_INTERNAL_JOB_SECRET` authentication.

Promotions and refund status notifications use the shared local notification service, so `MAIN_BACKEND_URL` and `MAIN_BACKEND_INTERNAL_API_TOKEN` are no longer needed by these flows. Notification delivery saves the in-app notification; push delivery depends on the existing Firebase configuration and recipient token and is best effort. Inactivity matching uses the chatbot's `lastSeen` field.

Shared models preserve wallet adjustment IDs, refund transaction IDs (unique sparse index), and counselor earning adjustment metadata. Existing chatbot schema validation and currency defaults are preserved. Review maps to the existing ratings collection.

Checks: `npm run test:single -- test/adminIntegration.test.js test/notificationRoutes.test.js test/paidSessionBilling.test.js test/apiFreshness.test.js`. These use stubs and do not validate a live database, payment provider, or frontend deployment.

Validation result: focused suite 33 passing; full suite 92 passing and 8 failing. Four chat-expiry assertions, one Google/chat-flow assertion, and one OTP-provider assertion also fail in an isolated copy using pre-integration tracked app/model/controller files (with the missing apiFreshness import restored so it can load). Two socket recovery tests require absent sibling chatbot-app and chatbot-frontend folders. Local admin credentials have been restored from the original admin configuration. Login and authenticated profile HTTP checks both returned 200. Restart the running backend to load the updated environment.

## Create admin accounts

`POST /api/admin/auth/create-admin` requires `Authorization: Bearer <existing-admin-token>` and JSON:

```json
{"name":"Arun","email":"arun@example.com","password":"ExamplePass123","confirmPassword":"ExamplePass123"}
```

`fullName` is also accepted instead of `name`. Passwords require at least eight characters, at most 72 UTF-8 bytes, and matching confirmation. The server fixes `role` to `admin`, hashes the password, and stores the account in the existing `users` collection. No phone number is required for an admin. Extra fields such as wallet balance or caller-supplied role are ignored. Existing emails, including regular users/counsellors and the legacy environment admin, return 409 and are not promoted or overwritten.

201 response: `{"success":true,"message":"Admin created successfully","admin":{"_id":"...","fullName":"Arun","email":"arun@example.com","role":"admin","isActive":true,"createdAt":"..."}}`. No password/hash is returned. Validation errors return 400; missing/invalid admin authentication returns 401.

New accounts log in through the same `POST /api/admin/auth/login` with email/password. Their Bearer tokens work on admin APIs; `/profile` returns their own identity and `/change-password` updates their database password. Each authenticated request verifies they still have an active admin account. The existing environment admin remains available for bootstrap and compatibility. Restart the backend before testing the frontend.

Admin account regression tests: `npm run test:single -- test/adminAccounts.test.js test/adminIntegration.test.js test/passwordPolicy.test.js`. Database operations are stubbed and Mongoose document validation runs; no real admin accounts are inserted by these tests.
