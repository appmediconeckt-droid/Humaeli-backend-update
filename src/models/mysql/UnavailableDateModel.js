// src/models/mysql/UnavailableDateModel.js
import BaseModel from "./BaseModel.js";

export class UnavailableDate extends BaseModel {
  static tableName = "unavailable_dates";
  static booleanFields = [];
  static jsonFields = [];
}

export default UnavailableDate;
