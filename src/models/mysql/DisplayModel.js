// src/models/mysql/DisplayModel.js
import BaseModel from "./BaseModel.js";

export class Display extends BaseModel {
  static tableName = "displays";
  static booleanFields = ["isActive"];
  static jsonFields = ["theme"];
}

export default Display;
