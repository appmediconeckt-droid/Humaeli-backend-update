export const ANONYMOUS_USER_NAME = "Anonymous User";

export const getUserPhotoUrl = (user) => {
  const readPhoto = (photo) => {
    if (!photo) return null;
    if (typeof photo === "object") {
      return readPhoto(photo.url || photo.secure_url || photo.uri || photo.src || photo.path);
    }
    if (typeof photo !== "string" || !photo.trim()) return null;
    const value = photo.trim();
    if (value.startsWith("{")) {
      try { return readPhoto(JSON.parse(value)); } catch { return null; }
    }
    return value;
  };
  return readPhoto(user?.profilePhoto) || readPhoto(user?.avatar) || null;
};

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
  const photo = getUserPhotoUrl(user);

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
    profilePhoto: photo ? { url: photo } : null,
    avatar: photo,
    avatarUrl: photo,
    Image: user.Image || null,
  };
};
