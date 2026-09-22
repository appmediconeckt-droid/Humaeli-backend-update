CREATE TABLE `loginotps` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `email` longtext DEFAULT NULL,
  `expiresAt` datetime(3) DEFAULT NULL,
  `otp` longtext DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  `userId` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_19015382d4fa5129` (`email`(191)),
  KEY `idx_e1a0f7bca955ecdc` (`expiresAt`),
  KEY `idx_91d97889341f2c4c` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
