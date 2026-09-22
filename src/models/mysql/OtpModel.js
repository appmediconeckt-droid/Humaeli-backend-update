// src/models/mysql/OtpModel.js
import BaseModel from "./BaseModel.js";

export class OTP extends BaseModel {
  static tableName = "otps";
  static booleanFields = [];
  static jsonFields = [];
}

export default OTP;
