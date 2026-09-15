# Firebase push notifications on Railway

A Windows path in `GOOGLE_APPLICATION_CREDENTIALS` points to a file on your
computer, not inside Railway's Linux container. It causes `ENOENT` during push
delivery.

In the backend service's Railway Variables:

1. Remove `GOOGLE_APPLICATION_CREDENTIALS` if it contains your local file path.
2. Set `FIREBASE_SERVICE_ACCOUNT` to the **entire contents** of your Firebase
   Admin service-account JSON file. Paste the JSON object directly, without
   surrounding single quotes or a file path. Keep every field, including
   `project_id`, `client_email`, and the complete `private_key`.
3. Redeploy the service and check for `Firebase Admin initialized` in the logs.
4. Trigger a notification to a device with a valid FCM token to verify delivery.

Use a key from the same Firebase project as the mobile app. If a key is needed,
Firebase Console > Project settings > Service accounts provides the key generation
option. Keep the JSON in private server variables; do not commit it or put it in
the mobile app.

`FIREBASE_SERVICE_ACCOUNT` takes precedence over application default credentials.
For deployments that mount a credentials file, `GOOGLE_APPLICATION_CREDENTIALS`
can instead contain its real path inside that server. Missing files are reported
at startup and push notifications remain disabled until configuration is fixed.

Reference: https://firebase.google.com/docs/admin/setup
