// import jwt from "jsonwebtoken";
import jwt from "jsonwebtoken";

export const generateAccessToken = (userId, sessionId, role) => {
  return jwt.sign({ userId, sessionId, role }, process.env.ACCESS_SECRET, {
    expiresIn: "15d",
  });
};

export const generateRefreshToken = (userId, sessionId, role) => {
  return jwt.sign(
    { userId, sessionId, role },
    process.env.REFRESH_SECRET,
    { expiresIn: "30d" },
  );
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.ACCESS_SECRET);
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.REFRESH_SECRET);
};

// export const generateAccessToken = (userId, sessionId) => {
//   const secret = process.env.ACCESS_SECRET;

//   if (!secret) {
//     throw new Error("ACCESS_TOKEN_SECRET is not defined");
//   }
//   return jwt.sign(
//     { userId, sessionId }, // 🔥 ADD THIS
//     process.env.ACCESS_SECRET,
//     { expiresIn: "15m" },
//   );
// };

// export const generateRefreshToken = (userId, sessionId) => {
//   return jwt.sign(
//     { userId, sessionId },  // ✅ ADD THIS
//     process.env.REFRESH_SECRET,
//     { expiresIn: "7d" }
//   );
// };

// export const verifyAccessToken = (token) => {
//   try {
//     const secret =  process.env.ACCESS_SECRET;
//     return jwt.verify(token,secret, process.env.ACCESS_SECRET);
//   } catch (error) {
//     throw error;
//   }
// };

// export const verifyRefreshToken = (token) => {
//   try {
//     const secret =
//      process.env.REFRESH_SECRET;
//     return jwt.verify(token,secret, process.env.REFRESH_SECRET);
//   } catch (error) {
//     throw error;
//   }
// };

export const generateAccessRefreshToken = async (user, sessionId) => {
  try {
    const accessToken = jwt.sign(
      { userId: user._id, sessionId, role: user.role },
      process.env.ACCESS_SECRET,
      { expiresIn: "15d" },
    );

    const refreshToken = jwt.sign(
      { userId: user._id, sessionId, role: user.role },
      process.env.REFRESH_SECRET,
      { expiresIn: "30d" },
    );

    user.refreshToken = refreshToken;
    user.sessionId = sessionId;

    await user.save();

    return { accessToken, refreshToken };
  } catch (error) {
    throw error;
  }
};
