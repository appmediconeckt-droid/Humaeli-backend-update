// src/models/mysql/DoctorBreakModel.js
import BaseModel from "./BaseModel.js";

export class DoctorBreak extends BaseModel {
  static tableName = "doctor_breaks";
  static booleanFields = [];
  static jsonFields = [];
}

export default DoctorBreak;
