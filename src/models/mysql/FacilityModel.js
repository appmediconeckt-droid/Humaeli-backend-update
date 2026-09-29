// src/models/mysql/FacilityModel.js
import BaseModel from "./BaseModel.js";

export class Facility extends BaseModel {
  static tableName = "facilities";
  static booleanFields = [];
  static jsonFields = ["address"];
}

export default Facility;
