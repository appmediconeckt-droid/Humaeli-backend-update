import 'dotenv/config';
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
    const serviceAccount = rawServiceAccount ? JSON.parse(rawServiceAccount) : null;

    // Environment variables commonly store private-key newlines as "\\n".
    if (typeof serviceAccount?.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    firebaseApp =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
          });
    messaging = getMessaging(firebaseApp);
    console.log('Firebase Admin initialized');
  } catch (error) {
    console.error(
      'Firebase push notifications disabled: invalid FIREBASE_SERVICE_ACCOUNT.',
      error.message,
    );
  }
}

export { firebaseApp, messaging };
