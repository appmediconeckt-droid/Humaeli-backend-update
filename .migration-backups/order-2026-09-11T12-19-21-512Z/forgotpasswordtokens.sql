CREATE TABLE `forgotpasswordtokens` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `email` longtext DEFAULT NULL,
  `expiresAt` datetime(3) DEFAULT NULL,
  `isUsed` tinyint(1) DEFAULT NULL,
  `otp` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_e1a0f7bca955ecdc` (`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
