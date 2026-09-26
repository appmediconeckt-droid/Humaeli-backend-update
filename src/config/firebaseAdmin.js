import {
  initializeApp,
  cert,
  getApps,
} from "firebase-admin/app";

import { getMessaging } from "firebase-admin/messaging";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccount;

// Railway / Production
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    );

    console.log("✅ Firebase credentials loaded from ENV");
  } catch (error) {
    console.error("❌ Invalid FIREBASE_SERVICE_ACCOUNT JSON");
    throw error;
  }
}

// Local development
else {
  const serviceAccountPath = path.join(
    __dirname,
    "serviceAccountKey.json"
  );

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      "Firebase service account not found in ENV or serviceAccountKey.json"
    );
  }

  serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, "utf8")
  );

  console.log("✅ Firebase credentials loaded from local JSON");
}

const firebaseApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert(serviceAccount),
      });

const messaging = getMessaging(firebaseApp);

// Attach send and other messaging methods directly to admin wrapper so both admin.send() and admin.messaging().send() work
const admin = {
  messaging: () => messaging,
  send: (msg) => messaging.send(msg),
  sendEach: (msgs) => messaging.sendEach(msgs),
  sendEachForMulticast: (msg) => messaging.sendEachForMulticast(msg),
};

console.log("✅ Firebase Admin initialized");

export { firebaseApp, messaging, admin };
export default messaging;