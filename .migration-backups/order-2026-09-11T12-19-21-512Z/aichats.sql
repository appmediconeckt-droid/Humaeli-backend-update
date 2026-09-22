CREATE TABLE `aichats` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `aiResponse` longtext DEFAULT NULL,
  `consultants` longtext DEFAULT NULL CHECK (json_valid(`consultants`)),
  `createdAt` datetime(3) DEFAULT NULL,
  `responseType` longtext DEFAULT NULL,
  `sessionId` longtext DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  `userId` varchar(191) DEFAULT NULL,
  `userMessage` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_40c1642a84c9a530` (`sessionId`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
