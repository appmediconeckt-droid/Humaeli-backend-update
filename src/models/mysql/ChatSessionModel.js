// src/models/mysql/ChatSessionModel.js
import BaseModel from "./BaseModel.js";

export class ChatSession extends BaseModel {
  static tableName = "chatsessions";
  static booleanFields = ["isActive"];
  static jsonFields = [];
}

export default ChatSession;
