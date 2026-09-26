import BaseModel from "./BaseModel.js";

export class AIChat extends BaseModel {
  static tableName = "aichats";
  static jsonFields = ["consultants"];
}

export default AIChat;
