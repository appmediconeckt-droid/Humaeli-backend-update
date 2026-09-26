// src/config/initAdminTables.js
// Automatically creates all MySQL tables required for the merged admin panel and subscriptions
import { query } from "./mysql.js";

export async function initAdminTables() {
  try {
    // 1. counseloronlinesubscriptions
    await query(`
      CREATE TABLE IF NOT EXISTS \`counseloronlinesubscriptions\` (
        \`id\` varchar(191) NOT NULL,
        \`userId\` varchar(191) NOT NULL,
        \`counselorId\` varchar(191) NOT NULL,
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_sub_user_counselor\` (\`userId\`, \`counselorId\`),
        KEY \`idx_sub_counselor\` (\`counselorId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // 2. adminaccounts
    await query(`
      CREATE TABLE IF NOT EXISTS \`adminaccounts\` (
        \`id\` varchar(191) NOT NULL,
        \`name\` varchar(191) NOT NULL,
        \`email\` varchar(191) NOT NULL,
        \`passwordHash\` varchar(255) NOT NULL,
        \`role\` varchar(50) DEFAULT 'admin',
        \`createdBy\` varchar(191) DEFAULT 'system',
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_admin_email\` (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // Ensure role column exists in adminaccounts if table already existed without it
    try {
      const [adminCols] = await query("SHOW COLUMNS FROM `adminaccounts` LIKE 'role'");
      if (!adminCols || adminCols.length === 0) {
        await query("ALTER TABLE `adminaccounts` ADD COLUMN `role` varchar(50) DEFAULT 'admin' AFTER `passwordHash`");
      }
    } catch (e) {
      // Ignore
    }

    // 3. settings
    await query(`
      CREATE TABLE IF NOT EXISTS \`settings\` (
        \`id\` varchar(191) NOT NULL,
        \`key\` varchar(191) NOT NULL,
        \`value\` longtext DEFAULT NULL,
        \`description\` text DEFAULT NULL,
        \`type\` varchar(50) DEFAULT 'string',
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_settings_key\` (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // 4. reviews
    await query(`
      CREATE TABLE IF NOT EXISTS \`reviews\` (
        \`id\` varchar(191) NOT NULL,
        \`userId\` varchar(191) NOT NULL,
        \`counselorId\` varchar(191) NOT NULL,
        \`rating\` double DEFAULT 5,
        \`review\` text DEFAULT NULL,
        \`comment\` text DEFAULT NULL,
        \`feedback\` text DEFAULT NULL,
        \`isApproved\` tinyint(1) DEFAULT 1,
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_reviews_counselor\` (\`counselorId\`),
        KEY \`idx_reviews_user\` (\`userId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // 5. supporttickets
    await query(`
      CREATE TABLE IF NOT EXISTS \`supporttickets\` (
        \`id\` varchar(191) NOT NULL,
        \`ticketId\` varchar(191) DEFAULT NULL,
        \`userId\` varchar(191) DEFAULT NULL,
        \`email\` varchar(191) DEFAULT NULL,
        \`subject\` varchar(255) DEFAULT NULL,
        \`message\` longtext DEFAULT NULL,
        \`status\` varchar(50) DEFAULT 'open',
        \`priority\` varchar(50) DEFAULT 'medium',
        \`responses\` json DEFAULT NULL,
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_tickets_status\` (\`status\`),
        KEY \`idx_tickets_user\` (\`userId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // 6. payouts
    await query(`
      CREATE TABLE IF NOT EXISTS \`payouts\` (
        \`id\` varchar(191) NOT NULL,
        \`counselorId\` varchar(191) NOT NULL,
        \`amount\` double DEFAULT 0,
        \`status\` varchar(50) DEFAULT 'pending',
        \`bankDetails\` json DEFAULT NULL,
        \`notes\` text DEFAULT NULL,
        \`processedAt\` datetime(3) DEFAULT NULL,
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_payouts_counselor\` (\`counselorId\`),
        KEY \`idx_payouts_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // 7. refundrequests
    await query(`
      CREATE TABLE IF NOT EXISTS \`refundrequests\` (
        \`id\` varchar(191) NOT NULL,
        \`userId\` varchar(191) NOT NULL,
        \`sessionId\` varchar(191) DEFAULT NULL,
        \`paymentId\` varchar(191) DEFAULT NULL,
        \`amount\` double DEFAULT 0,
        \`reason\` text DEFAULT NULL,
        \`status\` varchar(50) DEFAULT 'pending',
        \`adminNote\` text DEFAULT NULL,
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_refund_user\` (\`userId\`),
        KEY \`idx_refund_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // 8. auditlogs
    await query(`
      CREATE TABLE IF NOT EXISTS \`auditlogs\` (
        \`id\` varchar(191) NOT NULL,
        \`adminId\` varchar(191) DEFAULT NULL,
        \`adminName\` varchar(191) DEFAULT NULL,
        \`action\` varchar(191) NOT NULL,
        \`target\` varchar(191) DEFAULT NULL,
        \`details\` json DEFAULT NULL,
        \`ipAddress\` varchar(191) DEFAULT NULL,
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_audit_admin\` (\`adminId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // 9. counselorearnings
    await query(`
      CREATE TABLE IF NOT EXISTS \`counselorearnings\` (
        \`id\` varchar(191) NOT NULL,
        \`counselorId\` varchar(191) NOT NULL,
        \`sessionId\` varchar(191) DEFAULT NULL,
        \`amount\` double DEFAULT 0,
        \`counselorAmount\` double DEFAULT 0,
        \`platformFee\` double DEFAULT 0,
        \`sessionType\` varchar(50) DEFAULT 'chat',
        \`status\` varchar(50) DEFAULT 'pending',
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_earnings_counselor\` (\`counselorId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // 10. transactions
    await query(`
      CREATE TABLE IF NOT EXISTS \`transactions\` (
        \`id\` varchar(191) NOT NULL,
        \`userId\` varchar(191) NOT NULL,
        \`amount\` double DEFAULT 0,
        \`type\` varchar(50) DEFAULT 'credit',
        \`status\` varchar(50) DEFAULT 'completed',
        \`paymentId\` varchar(191) DEFAULT NULL,
        \`orderId\` varchar(191) DEFAULT NULL,
        \`description\` text DEFAULT NULL,
        \`metadata\` json DEFAULT NULL,
        \`createdAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`__v\` double DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_tx_user\` (\`userId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    `);

    // Seed default admin account if empty
    const adminEmail = process.env.ADMIN_EMAIL || "admin@mindcrawller.com";
    const passwordHash =
      process.env.ADMIN_PASSWORD_HASH ||
      "$2a$10$Ac5R.CziE/uYatpa4MSb9.Jr8jr9nDvdNtoN6MgxN/eYCTUIJbjBO"; // admin123
    const [existing] = await query("SELECT id FROM `adminaccounts` WHERE `email` = ? LIMIT 1", [
      adminEmail,
    ]);
    if (!existing || existing.length === 0) {
      await query(
        `INSERT INTO \`adminaccounts\` (\`id\`, \`name\`, \`email\`, \`passwordHash\`, \`role\`, \`createdBy\`, \`createdAt\`, \`updatedAt\`)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        ["admin_master_1", "Super Admin", adminEmail, passwordHash, "superadmin", "system"]
      );
      console.log(`✅ Default admin account created (${adminEmail})`);
    }

    console.log("✅ All MySQL admin and subscription tables initialized.");
  } catch (err) {
    console.warn("⚠️ initAdminTables warning:", err.message);
  }
}

export default initAdminTables;
