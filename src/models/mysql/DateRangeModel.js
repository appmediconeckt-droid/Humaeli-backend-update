// src/models/mysql/DateRangeModel.js
import BaseModel from "./BaseModel.js";

export class DateRange extends BaseModel {
  static tableName = "date_ranges";
  static booleanFields = ["is_unavailable"];
  static jsonFields = [];
}

export default DateRange;
