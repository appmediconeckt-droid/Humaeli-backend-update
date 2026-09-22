CREATE TABLE `appointments` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `counselor` varchar(191) DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `date` datetime(3) DEFAULT NULL,
  `notes` longtext DEFAULT NULL,
  `patient` varchar(191) DEFAULT NULL,
  `status` longtext DEFAULT NULL,
  `updatedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
