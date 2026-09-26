// src/models/mysql/ClinicModel.js
import BaseModel from "./BaseModel.js";

export class Clinic extends BaseModel {
  static tableName = "clinics";
  static booleanFields = [];
  static jsonFields = [];
}

export default Clinic;
