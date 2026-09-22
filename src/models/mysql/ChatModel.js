// src/models/mysql/ChatModel.js
import BaseModel from "./BaseModel.js";

export class Chat extends BaseModel {
  static tableName = "chats";
  static booleanFields = [
    "isActive",
    "deletedByUser",
    "deletedByCounselor",
    "archivedByUser",
    "archivedByCounselor",
  ];
  static jsonFields = [];
}

export default Chat;
