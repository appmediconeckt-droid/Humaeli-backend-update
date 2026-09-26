import BaseModel from "./BaseModel.js";

export default class Prescription extends BaseModel {
  static tableName = "prescriptions";
  static booleanFields = [];
  static jsonFields = ["patientSnapshot", "psychiatristSnapshot", "patientPhoto", "identityVerification", "medicines", "pdf"];
}
