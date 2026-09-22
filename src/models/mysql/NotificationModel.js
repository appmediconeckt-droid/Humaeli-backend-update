// src/models/mysql/NotificationModel.js
import BaseModel from "./BaseModel.js";

export class Notification extends BaseModel {
  static tableName = "notifications";
  static booleanFields = ["isRead"];
  static jsonFields = ["data"];
}

export default Notification;
