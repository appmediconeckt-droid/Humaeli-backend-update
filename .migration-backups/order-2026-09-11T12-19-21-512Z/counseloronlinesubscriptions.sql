CREATE TABLE `counseloronlinesubscriptions` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `counselorId` varchar(191) DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  `userId` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_d88d957f3c0205e4` (`counselorId`),
  KEY `idx_91d97889341f2c4c` (`userId`),
  KEY `idx_212fab7093cdd16c` (`userId`,`counselorId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
