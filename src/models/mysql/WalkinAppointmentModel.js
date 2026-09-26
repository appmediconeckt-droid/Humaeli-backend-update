// src/models/mysql/WalkinAppointmentModel.js
import BaseModel from "./BaseModel.js";

export class WalkinAppointment extends BaseModel {
  static tableName = "walkin_appointments";
  static booleanFields = ["follow_up_required"];
  static jsonFields = ["consultation_timing"];
}

export default WalkinAppointment;
