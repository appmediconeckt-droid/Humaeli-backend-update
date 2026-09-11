import dotenv from "dotenv";
import mongoose from "../src/persistence/mongoose.js";
import bcrypt from "bcryptjs";
import dns from "node:dns";
import connectDB from "../src/config/db.js";
import User from "../src/models/userModel.js";
import { PLAY_REVIEW_TEST_EMAILS } from "../src/services/otpService.js";

dotenv.config();
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const TEST_PASSWORD = process.env.PLAY_REVIEW_TEST_PASSWORD || "Humaeli@123";

const accounts = [
  {
    fullName: "Humaeli Play Review User",
    email: PLAY_REVIEW_TEST_EMAILS[0],
    phoneNumber: "9000000001",
    role: "user",
  },
  {
    fullName: "Humaeli Play Review Counselor",
    email: PLAY_REVIEW_TEST_EMAILS[1],
    phoneNumber: "9000000002",
    role: "counsellor",
    qualification: "M.Sc. Psychology",
    specialization: ["Mental Wellness"],
    experience: 5,
    location: "Bhopal",
    consultationMode: ["online"],
    languages: ["English", "Hindi"],
    aboutMe: "Play Store review account for testing the counselor experience.",
    isVerified: true,
  },
];

async function seedPlayReviewAccounts() {
  await connectDB();
  const password = await bcrypt.hash(TEST_PASSWORD, 10);

  for (const account of accounts) {
    await User.findOneAndUpdate(
      { email: account.email },
      {
        $set: {
          ...account,
          password,
          authProvider: "local",
          profileCompleted: true,
          isEmailVerified: true,
          isPhoneVerified: true,
          isActive: true,
          locationData: {
            current: { type: "Point", coordinates: [0, 0] },
            history: [],
          },
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    );

    console.log(`Seeded ${account.role}: ${account.email}`);
  }
}

seedPlayReviewAccounts()
  .then(async () => {
    console.log("Play review accounts are ready.");
    await mongoose.disconnect();
  })
  .catch(async (error) => {
    console.error("Failed to seed Play review accounts:", error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
