// src/models/mysql/RatingStatusModel.js
import BaseModel from "./BaseModel.js";

export class RatingStatus extends BaseModel {
  static tableName = "ratingstatuses";
  static booleanFields = ["hasRated"];
  static jsonFields = [];
}

export default RatingStatus;
