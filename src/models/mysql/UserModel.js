// src/models/mysql/UserModel.js
import BaseModel from "./BaseModel.js";

const calculateAgeFromDateOfBirth = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const birthdayThisYear = new Date(Date.UTC(
    today.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  const todayUtc = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  ));

  if (todayUtc < birthdayThisYear) age -= 1;
  return age >= 0 ? age : null;
};

export class User extends BaseModel {
  static tableName = "users";

  static jsonFields = [
    "walletCreditPaymentIds",
    "chatContext",
    "address",
    "emergencyContact",
    "medicalInfo",
    "insuranceInfo",
    "specialization",
    "consultationMode",
    "languages",
    "certifications",
    "chatPermission",
    "payoutAccount",
    "locationData",
    "walletAdjustmentIds",
    "emailOTP",
    "phoneOTP",
    "profilePhoto",
    "permanentAddress",
    "staffCertifications",
    "availability",
  ];

  static booleanFields = [
    "profileCompleted",
    "isEmailVerified",
    "isPhoneVerified",
    "isActive",
    "isVerified",
    "isOnline",
    "locationConsent",
    "activeWalletRefundRequest",
  ];

  toJSON() {
    const user = this.toObject();
    const ageFromDateOfBirth = calculateAgeFromDateOfBirth(user.dateOfBirth);
    if (ageFromDateOfBirth !== null) {
      user.age = ageFromDateOfBirth;
    }
    user.hasPassword = Boolean(user.password);
    delete user.password;
    delete user.profilePhotoPublicId;
    delete user.emailOTP;
    delete user.phoneOTP;
    return user;
  }
}

export default User;
