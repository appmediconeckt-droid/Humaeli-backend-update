// src/models/mysql/AdminAccountModel.js
import BaseModel from "./BaseModel.js";

export class AdminAccount extends BaseModel {
  static tableName = "adminaccounts";
  static booleanFields = [];
  static jsonFields = [];
}

export default AdminAccount;
