CREATE TABLE `sessions` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT NULL,
  `lastActivityAt` datetime(3) DEFAULT NULL,
  `logoutAt` datetime(3) DEFAULT NULL,
  `refreshToken` longtext DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  `userId` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_297d0ef44ea61891` (`lastActivityAt`),
  KEY `idx_1d62ad3ff0402fce` (`refreshToken`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
