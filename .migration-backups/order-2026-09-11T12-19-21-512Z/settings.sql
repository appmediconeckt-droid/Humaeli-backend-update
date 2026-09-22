CREATE TABLE `settings` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `category` longtext DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `description` longtext DEFAULT NULL,
  `key` longtext DEFAULT NULL,
  `type` longtext DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  `updatedBy` varchar(191) DEFAULT NULL,
  `value` longtext DEFAULT NULL CHECK (json_valid(`value`)),
  PRIMARY KEY (`id`),
  KEY `idx_0c08dbd4adb6472c` (`key`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
