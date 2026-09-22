// src/models/mysql/MessageModel.js
import BaseModel from "./BaseModel.js";

export class Message extends BaseModel {
  static tableName = "messages";
  static booleanFields = ["isRead"];
  static jsonFields = ["deletedFor"];
}

export default Message;
