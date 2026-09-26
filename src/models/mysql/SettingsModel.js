// src/models/mysql/SettingsModel.js
import BaseModel from "./BaseModel.js";

export class Settings extends BaseModel {
  static tableName = "settings";
  static booleanFields = [];
  static jsonFields = ["value"];
}

export default Settings;
