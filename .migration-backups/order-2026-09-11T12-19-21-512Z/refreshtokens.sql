CREATE TABLE `refreshtokens` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `ipAddress` longtext DEFAULT NULL,
  `token` longtext DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  `userAgent` longtext DEFAULT NULL,
  `userId` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ccee1a67bb5b1c0b` (`token`(191)),
  KEY `idx_91d97889341f2c4c` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
