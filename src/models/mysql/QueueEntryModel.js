// src/models/mysql/QueueEntryModel.js
import BaseModel from "./BaseModel.js";

export class QueueEntry extends BaseModel {
  static tableName = "queue_entries";
  static booleanFields = [];
  static jsonFields = [];
}

export default QueueEntry;
