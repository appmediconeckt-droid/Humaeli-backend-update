export const ACCESS_TOKEN_MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function authCookieOptions(maxAge) {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge,
  };
}

export function clearAuthCookieOptions() {
  const { maxAge, ...options } = authCookieOptions(0);
  return options;
}

export function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie("accessToken", accessToken, authCookieOptions(ACCESS_TOKEN_MAX_AGE_MS));
  res.cookie("refreshToken", refreshToken, authCookieOptions(REFRESH_TOKEN_MAX_AGE_MS));
}

export function clearAuthCookies(res) {
  const options = clearAuthCookieOptions();
  res.clearCookie("accessToken", options);
  res.clearCookie("refreshToken", options);
}
