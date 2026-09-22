// src/models/mysql/SessionModel.js
import BaseModel from "./BaseModel.js";

export class Session extends BaseModel {
  static tableName = "sessions";

  static booleanFields = ["isActive"];

  static jsonFields = [];
}

export default Session;
