CREATE TABLE `conversations` (
  `id` varchar(191) NOT NULL,
  `__v` double DEFAULT NULL,
  `archivedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) DEFAULT NULL,
  `lastMessage` longtext DEFAULT NULL,
  `lastMessageSender` longtext DEFAULT NULL,
  `lastMessageTime` datetime(3) DEFAULT NULL,
  `participants` longtext DEFAULT NULL CHECK (json_valid(`participants`)),
  `status` longtext DEFAULT NULL,
  `unreadCount` longtext DEFAULT NULL CHECK (json_valid(`unreadCount`)),
  `updatedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
