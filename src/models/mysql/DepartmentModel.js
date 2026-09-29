// src/models/mysql/DepartmentModel.js
import BaseModel from "./BaseModel.js";

export class Department extends BaseModel {
  static tableName = "departments";
  static booleanFields = [];
  static jsonFields = [];
}

export default Department;
