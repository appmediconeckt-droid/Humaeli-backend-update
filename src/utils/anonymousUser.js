export const ANONYMOUS_USER_NAME = "Anonymous User";

const asTrimmedString = (value) =>
  typeof value === "string" ? value.trim() : "";

export const getAnonymousUserName = (
  user,
  fallback = ANONYMOUS_USER_NAME,
) => {
  const anonymous = asTrimmedString(user?.anonymous);
  return anonymous || fallback;
};

export const sanitizeUserForCounselor = (user, fallbackId = null) => {
  if (!user) {
    return fallbackId
      ? {
          id: String(fallbackId),
          _id: String(fallbackId),
          name: ANONYMOUS_USER_NAME,
          fullName: "",
          anonymous: ANONYMOUS_USER_NAME,
          email: "",
          profilePhoto: null,
          avatar: null,
          avatarUrl: null,
        }
      : null;
  }

  const id = user._id || user.id || fallbackId;
  const anonymous = getAnonymousUserName(user);

  return {
    id: id ? String(id) : null,
    _id: id ? String(id) : null,
    name: anonymous,
    fullName: "",
    anonymous,
    email: "",
    gender: user.gender || "",
    age: user.age || null,
    dateOfBirth: user.dateOfBirth || null,
    isActive: Boolean(user.isActive),
    isOnline: Boolean(user.isOnline),
    online: Boolean(user.isOnline),
    lastSeen: user.lastSeen || null,
    profilePhoto: null,
    avatar: null,
    avatarUrl: null,
    Image: null,
  };
};
