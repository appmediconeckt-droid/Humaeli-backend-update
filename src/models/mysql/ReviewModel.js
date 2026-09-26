// src/models/mysql/ReviewModel.js
import BaseModel from "./BaseModel.js";

export class Review extends BaseModel {
  static tableName = "ratings";
  static booleanFields = [];
  static jsonFields = [];
}

export default Review;
