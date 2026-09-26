// src/models/mysql/FollowUpModel.js
import BaseModel from "./BaseModel.js";

export class FollowUp extends BaseModel {
  static tableName = "follow_ups";
  static booleanFields = [];
  static jsonFields = [];
}

export default FollowUp;
