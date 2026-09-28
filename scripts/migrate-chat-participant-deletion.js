import dotenv from "dotenv";
import mongoose from "../src/persistence/mongoose.js";
import connectDB from "../src/config/db.js";
import Chat from "../src/models/Chat.js";

dotenv.config();

async function migrate() {
  await connectDB();

  const result = await Chat.updateMany(
    {
      $or: [
        { deletedByUser: { $exists: false } },
        { deletedByCounselor: { $exists: false } },
      ],
    },
    [
      {
        $set: {
          deletedByUser: { $ifNull: ["$deletedByUser", false] },
          deletedByCounselor: { $ifNull: ["$deletedByCounselor", false] },
        },
      },
    ],
  );

  const legacyRestoreResult = await Chat.updateMany(
    {
      isActive: false,
      status: { $in: ["accepted", "active"] },
    },
    {
      $set: {
        isActive: true,
        deletedByUser: false,
        deletedByCounselor: false,
      },
    },
  );

  await Chat.collection.createIndex(
    { userId: 1, counselorId: 1 },
    { unique: true, name: "userId_1_counselorId_1" },
  );

  console.log(
    `Chat deletion-state migration complete. Initialized ${result.modifiedCount} chats and restored ${legacyRestoreResult.modifiedCount} legacy shared-hidden chats.`,
  );
}

migrate()
  .catch((error) => {
    console.error("Chat deletion-state migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
