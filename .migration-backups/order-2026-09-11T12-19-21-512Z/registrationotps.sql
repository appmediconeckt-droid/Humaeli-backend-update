CREATE TABLE `registrationotps` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `email` longtext DEFAULT NULL,
  `expiresAt` datetime(3) DEFAULT NULL,
  `otp` longtext DEFAULT NULL,
  `purpose` longtext DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_19015382d4fa5129` (`email`(191)),
  KEY `idx_fbdea3769fa762c6` (`email`(191),`otp`(191),`purpose`(191),`expiresAt`),
  KEY `idx_e1a0f7bca955ecdc` (`expiresAt`),
  KEY `idx_713960cb98a31989` (`purpose`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
