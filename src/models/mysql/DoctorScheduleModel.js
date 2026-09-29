// src/models/mysql/DoctorScheduleModel.js
import BaseModel from "./BaseModel.js";

export class DoctorSchedule extends BaseModel {
  static tableName = "doctor_schedules";
  static booleanFields = ["isActive"];
  static jsonFields = [];
}

export default DoctorSchedule;
