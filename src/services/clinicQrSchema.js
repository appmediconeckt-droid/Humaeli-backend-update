export const clinicQrSchema = [
  `CREATE TABLE IF NOT EXISTS doctor_clinic_links (
    id VARCHAR(64) PRIMARY KEY, doctor_id VARCHAR(191) NOT NULL, clinic_id VARCHAR(191) NULL,
    facility_id VARCHAR(191) NOT NULL, mapping_id VARCHAR(191) NOT NULL UNIQUE,
    source_key VARCHAR(255) NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(doctor_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS qr_codes (
    id VARCHAR(64) PRIMARY KEY, qr_type ENUM('DOCTOR_PROFILE','CLINIC_WALKIN') NOT NULL,
    doctor_id VARCHAR(191) NOT NULL, doctor_clinic_id VARCHAR(64) NULL,
    qr_token VARCHAR(64) NOT NULL UNIQUE, scope_key VARCHAR(255) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS clinic_qr_requests (
    doctor_clinic_id VARCHAR(64) NOT NULL, request_id VARCHAR(64) NOT NULL,
    appointment_id VARCHAR(191) NOT NULL, queue_entry_id VARCHAR(191) NOT NULL,
    PRIMARY KEY(doctor_clinic_id,request_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];
