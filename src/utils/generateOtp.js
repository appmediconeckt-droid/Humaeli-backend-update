import OTP from "../models/otpModel.js";
import User from "../models/userModel.js";
import otpService from "../services/otpService.js";

export const generateOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required", success: false });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    const otp = otpService.generateOTP(normalizedEmail);

    // delete old OTPs for this user
    await OTP.deleteMany({ userId: user._id });

    await OTP.create({
      userId: user._id,
      otp: String(otp),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    // Send via Brevo (same as login OTP)
    await otpService.sendLoginOTP(normalizedEmail, otp);

    return res.status(200).json({
      message: "OTP sent successfully",
      success: true,
    });

  } catch (error) {
    console.error("generateOtp error:", error);
    return res.status(500).json({
      message: "Error sending OTP. Please try again.",
      success: false,
    });
  }
};
