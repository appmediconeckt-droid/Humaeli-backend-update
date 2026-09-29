import { query } from "../config/mysql.js";
import { clinicQrSchema } from './clinicQrSchema.js';

let tablesInitialized = false;

export async function initQueueTables() {
  if (tablesInitialized) return;

  try {
    // 1. Facilities (Hospitals / Clinics)
    await query(`
      CREATE TABLE IF NOT EXISTS \`facilities\` (
        \`id\` VARCHAR(191) PRIMARY KEY,
        \`organizationId\` VARCHAR(191) NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`type\` VARCHAR(50) DEFAULT 'hospital',
        \`address\` JSON NULL,
        \`phone\` VARCHAR(50) NULL,
        \`email\` VARCHAR(191) NULL,
        \`status\` VARCHAR(50) DEFAULT 'active',
        \`createdAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Departments
    await query(`
      CREATE TABLE IF NOT EXISTS \`departments\` (
        \`id\` VARCHAR(191) PRIMARY KEY,
        \`facilityId\` VARCHAR(191) NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`code\` VARCHAR(50) NOT NULL,
        \`floor\` VARCHAR(50) NULL,
        \`status\` VARCHAR(50) DEFAULT 'active',
        \`createdAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX \`idx_dept_facility\` (\`facilityId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. DoctorFacility Mapping
    await query(`
      CREATE TABLE IF NOT EXISTS \`doctor_facilities\` (
        \`id\` VARCHAR(191) PRIMARY KEY,
        \`doctorId\` VARCHAR(191) NOT NULL,
        \`facilityId\` VARCHAR(191) NOT NULL,
        \`departmentId\` VARCHAR(191) NULL,
        \`roomId\` VARCHAR(100) NULL,
        \`consultationDuration\` INT DEFAULT 15,
        \`isActive\` TINYINT(1) DEFAULT 1,
        \`createdAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX \`idx_df_doc\` (\`doctorId\`),
        INDEX \`idx_df_facility\` (\`facilityId\`),
        INDEX \`idx_df_dept\` (\`departmentId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. DoctorSchedules
    await query(`
      CREATE TABLE IF NOT EXISTS \`doctor_schedules\` (
        \`id\` VARCHAR(191) PRIMARY KEY,
        \`doctorId\` VARCHAR(191) NOT NULL,
        \`facilityId\` VARCHAR(191) NOT NULL,
        \`departmentId\` VARCHAR(191) NULL,
        \`day\` VARCHAR(50) NOT NULL,
        \`startTime\` VARCHAR(20) NOT NULL,
        \`endTime\` VARCHAR(20) NOT NULL,
        \`slotDuration\` INT DEFAULT 15,
        \`maxPatients\` INT DEFAULT 20,
        \`isActive\` TINYINT(1) DEFAULT 1,
        \`createdAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX \`idx_ds_doc\` (\`doctorId\`),
        INDEX \`idx_ds_facility\` (\`facilityId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. QueueEntries
    await query(`
      CREATE TABLE IF NOT EXISTS \`queue_entries\` (
        \`id\` VARCHAR(191) PRIMARY KEY,
        \`appointmentId\` VARCHAR(191) NULL,
        \`patientId\` VARCHAR(191) NULL,
        \`patientName\` VARCHAR(255) NOT NULL,
        \`patientPhone\` VARCHAR(50) NULL,
        \`facilityId\` VARCHAR(191) NOT NULL,
        \`departmentId\` VARCHAR(191) NULL,
        \`doctorId\` VARCHAR(191) NOT NULL,
        \`roomId\` VARCHAR(100) NULL,
        \`tokenNumber\` VARCHAR(50) NOT NULL,
        \`queueDate\` VARCHAR(20) NOT NULL,
        \`queuePosition\` INT NOT NULL DEFAULT 1,
        \`status\` VARCHAR(50) DEFAULT 'waiting',
        \`bookingSource\` VARCHAR(50) DEFAULT 'reception',
        \`notes\` TEXT NULL,
        \`checkedInAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`calledAt\` DATETIME(3) NULL,
        \`consultationStartedAt\` DATETIME(3) NULL,
        \`completedAt\` DATETIME(3) NULL,
        \`createdAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX \`idx_qe_facility_doc_date\` (\`facilityId\`, \`doctorId\`, \`queueDate\`),
        INDEX \`idx_qe_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Displays (TV / LED displays)
    await query(`
      CREATE TABLE IF NOT EXISTS \`displays\` (
        \`id\` VARCHAR(191) PRIMARY KEY,
        \`facilityId\` VARCHAR(191) NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`displayType\` VARCHAR(50) NOT NULL,
        \`departmentId\` VARCHAR(191) NULL,
        \`doctorId\` VARCHAR(191) NULL,
        \`floor\` VARCHAR(50) NULL,
        \`isActive\` TINYINT(1) DEFAULT 1,
        \`theme\` JSON NULL,
        \`createdAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX \`idx_disp_facility\` (\`facilityId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    for (const sql of clinicQrSchema) await query(sql);
    tablesInitialized = true;
    console.log("✅ Queue, Facility, and Display tables initialized successfully.");
  } catch (error) {
    console.error("❌ Error initializing queue tables:", error.message);
    throw error;
  }
}

export default initQueueTables;
