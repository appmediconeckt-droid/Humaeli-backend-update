// src/models/mysql/AuditLogModel.js
import BaseModel from "./BaseModel.js";

export class AuditLog extends BaseModel {
  static tableName = "auditlogs";
  static booleanFields = [];
  static jsonFields = ["changes"];
}

export default AuditLog;
