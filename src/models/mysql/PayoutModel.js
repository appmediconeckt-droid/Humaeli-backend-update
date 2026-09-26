// src/models/mysql/PayoutModel.js
import BaseModel from "./BaseModel.js";

export class Payout extends BaseModel {
  static tableName = "payouts";
  static booleanFields = [];
  static jsonFields = ["bankDetails", "metadata", "period"];

  async save() {
    if (this.amount !== undefined) {
      const tax = Number(this.taxAmount) || 0;
      this.netAmount = Number(this.amount) - tax;
    }
    return super.save();
  }
}

export default Payout;
