import { query } from "../src/config/mysql.js";

async function createAdminTables() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS \`adminaccounts\` (
        \`id\` varchar(191) NOT NULL,
        \`name\` varchar(191) NOT NULL,
        \`email\` varchar(191) NOT NULL,
        \`passwordHash\` varchar(255) NOT NULL,
        \`createdBy\` varchar(191) NOT NULL,
        \`createdAt\` datetime(3) DEFAULT NULL,
        \`updatedAt\` datetime(3) DEFAULT NULL,
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_admin_email\` (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);
    console.log("✅ adminaccounts table verified/created in MySQL.");
  } catch (err) {
    console.error("❌ Failed to create admin tables:", err.message);
  } finally {
    process.exit(0);
  }
}

createAdminTables();
