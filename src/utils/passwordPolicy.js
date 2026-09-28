export const STRONG_PASSWORD_MESSAGE =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";

const requirements = [
  (password) => String(password || "").length >= 8,
  (password) => /[A-Z]/.test(String(password || "")),
  (password) => /[a-z]/.test(String(password || "")),
  (password) => /\d/.test(String(password || "")),
  (password) => /[^A-Za-z0-9]/.test(String(password || "")),
];

export const isStrongPassword = (password) =>
  requirements.every((requirement) => requirement(password));

export const getStrongPasswordError = (password, fieldName = "Password") => {
  if (isStrongPassword(password)) return "";
  return fieldName === "Password"
    ? STRONG_PASSWORD_MESSAGE
    : `${fieldName} must be at least 8 characters and include uppercase, lowercase, number, and special character.`;
};
