// src/models/mysql/TransactionModel.js
import BaseModel from "./BaseModel.js";

export class Transaction extends BaseModel {
  static tableName = "transactions";
  static booleanFields = [];
  static jsonFields = ["metadata"];
}

export default Transaction;
