// src/models/mysql/CallModel.js
import BaseModel from "./BaseModel.js";

export class Call extends BaseModel {
  static tableName = "calls";
  static booleanFields = [];
  static jsonFields = ["callerLocation", "receiverLocation"];
}

export default Call;
