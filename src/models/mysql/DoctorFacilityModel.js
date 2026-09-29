// src/models/mysql/DoctorFacilityModel.js
import BaseModel from "./BaseModel.js";

export class DoctorFacility extends BaseModel {
  static tableName = "doctor_facilities";
  static booleanFields = ["isActive"];
  static jsonFields = [];
}

export default DoctorFacility;
