CREATE TABLE `auditlogs` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `action` longtext DEFAULT NULL,
  `adminEmail` longtext DEFAULT NULL,
  `adminId` varchar(191) DEFAULT NULL,
  `changes` longtext DEFAULT NULL CHECK (json_valid(`changes`)),
  `createdAt` datetime(3) DEFAULT NULL,
  `details` longtext DEFAULT NULL,
  `entityId` varchar(191) DEFAULT NULL,
  `entityName` longtext DEFAULT NULL,
  `entityType` longtext DEFAULT NULL,
  `ipAddress` longtext DEFAULT NULL,
  `reason` longtext DEFAULT NULL,
  `status` longtext DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
