// src/models/mysql/ConversationModel.js
import BaseModel from "./BaseModel.js";

export class Conversation extends BaseModel {
  static tableName = "conversations";
  static booleanFields = [];
  static jsonFields = [];
}

export default Conversation;
