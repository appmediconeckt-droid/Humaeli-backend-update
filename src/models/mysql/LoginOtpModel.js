// src/models/mysql/LoginOtpModel.js
import BaseModel from "./BaseModel.js";

export class LoginOTP extends BaseModel {
  static tableName = "loginotps";
  static booleanFields = [];
  static jsonFields = [];
}

export default LoginOTP;
