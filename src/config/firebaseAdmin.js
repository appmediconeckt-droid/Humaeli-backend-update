import 'dotenv/config';
import { statSync } from 'node:fs';
import { applicationDefault, initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

let firebaseApp = null;
let messaging = null;

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
const hasApplicationDefaultCredentials = Boolean(
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT,
);

if (!rawServiceAccount && !hasApplicationDefaultCredentials) {
  console.warn(
    'Firebase push notifications disabled: FIREBASE_SERVICE_ACCOUNT is not configured.',
  );
} else {
  try {
    if (!rawServiceAccount && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      let isFile = false;
      try {
        isFile = statSync(process.env.GOOGLE_APPLICATION_CREDENTIALS).isFile();
      } catch {
        // A local Windows path is not available inside a Railway container.
      }
      if (!isFile) {
        throw new Error(
          'GOOGLE_APPLICATION_CREDENTIALS must point to a file on this server. ' +
          'On Railway, remove the local file path and set FIREBASE_SERVICE_ACCOUNT to the full service-account JSON.',
        );
      }
    }
    let serviceAccount = null;
    if (rawServiceAccount) {
      try {
        serviceAccount = JSON.parse(rawServiceAccount);
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT must contain valid service-account JSON, not a file path.');
      }
      if (!serviceAccount || typeof serviceAccount !== 'object' || Array.isArray(serviceAccount)) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT must contain a service-account JSON object.');
      }
    }

    // Environment variables commonly store private-key newlines as "\\n".
    if (typeof serviceAccount?.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    firebaseApp =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
            ...(serviceAccount ? { projectId: serviceAccount.project_id || serviceAccount.projectId } : {}),
          });
    messaging = getMessaging(firebaseApp);
    console.log('Firebase Admin initialized');
  } catch (error) {
    console.error(
      'Firebase push notifications disabled: invalid credentials configuration.',
      error.message,
    );
  }
}

export { firebaseApp, messaging };
