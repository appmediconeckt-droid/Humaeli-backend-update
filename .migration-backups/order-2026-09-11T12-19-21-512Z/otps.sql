CREATE TABLE `otps` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `expiresAt` datetime(3) DEFAULT NULL,
  `otp` longtext DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  `userId` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
