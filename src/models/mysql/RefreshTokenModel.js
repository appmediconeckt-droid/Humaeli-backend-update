// src/models/mysql/RefreshTokenModel.js
import BaseModel from "./BaseModel.js";

export class RefreshToken extends BaseModel {
  static tableName = "refreshtokens";
  static booleanFields = [];
  static jsonFields = [];
}

export default RefreshToken;
