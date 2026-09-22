// src/models/mysql/ForgotPasswordTokenModel.js
import BaseModel from "./BaseModel.js";

export class ForgotPasswordToken extends BaseModel {
  static tableName = "forgotpasswordtokens";
  static booleanFields = ["isUsed"];
  static jsonFields = [];

  isExpired() {
    return new Date(this.expiresAt) < new Date();
  }

  isValid() {
    return !this.isUsed && !this.isExpired();
  }
}

export default ForgotPasswordToken;
