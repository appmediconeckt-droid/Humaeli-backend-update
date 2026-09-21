import User from '../models/userModel.js';
export const normalizeDateOfBirth = (dateOfBirth) => {
  if (
    dateOfBirth === undefined ||
    dateOfBirth === null ||
    String(dateOfBirth).trim() === ""
  ) {
    return { provided: false, value: null };
  }

  let value = String(dateOfBirth).trim();

  // Accept the legacy DD/MM/YYYY value used by older frontend forms, then
  // store every date in MySQL's canonical YYYY-MM-DD format.
  const legacyDateMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (legacyDateMatch) {
    const [, day, month, year] = legacyDateMatch;
    value = `${year}-${month}-${day}`;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error("date_of_birth must be in YYYY-MM-DD or DD/MM/YYYY format");
    error.statusCode = 400;
    throw error;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    parsedDate.getUTCFullYear() === year &&
    parsedDate.getUTCMonth() === month - 1 &&
    parsedDate.getUTCDate() === day;

  if (!isRealDate || parsedDate.getTime() > Date.now()) {
    const error = new Error("Please provide a valid date_of_birth");
    error.statusCode = 400;
    throw error;
  }

  return { provided: true, value };
};

export const savePatientDateOfBirth = async (patientId, dateOfBirth) => {
  const parsed = normalizeDateOfBirth(dateOfBirth);
  if (!parsed.provided) return;
  return User.updateOne({ _id: patientId, role: 'user' }, { $set: { dateOfBirth: new Date(parsed.value) } }, { runValidators: true });
};
