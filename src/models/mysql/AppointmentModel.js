// src/models/mysql/AppointmentModel.js
import BaseModel from "./BaseModel.js";

export class Appointment extends BaseModel {
  static tableName = "appointments";
  static booleanFields = [];
  static jsonFields = ["patient_location", "vitals", "symptoms"];
}

export default Appointment;
