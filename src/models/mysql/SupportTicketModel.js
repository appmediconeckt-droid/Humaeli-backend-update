// src/models/mysql/SupportTicketModel.js
import BaseModel from "./BaseModel.js";

export class SupportTicket extends BaseModel {
  static tableName = "supporttickets";
  static booleanFields = ["unreadByAdmin"];
  static jsonFields = ["messages", "callDispute"];
}

export default SupportTicket;
