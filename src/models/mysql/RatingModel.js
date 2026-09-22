// src/models/mysql/RatingModel.js
import BaseModel from "./BaseModel.js";

export class Rating extends BaseModel {
  static tableName = "ratings";
  static booleanFields = [];
  static jsonFields = [];
}

export default Rating;
