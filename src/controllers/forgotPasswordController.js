// controllers/forgotPasswordController.js
import User from '../models/userModel.js';
import ForgotPasswordToken from '../models/ForgotPasswordToken.js';
import bcrypt from 'bcryptjs';
import otpService from '../services/otpService.js';
import { getStrongPasswordError } from '../utils/passwordPolicy.js';

// ==================== SEND FORGOT PASSWORD OTP ====================
export const sendForgotPasswordOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address',
      });
    }

    const otp = otpService.generateOTP(normalizedEmail);

    await ForgotPasswordToken.deleteMany({ email: normalizedEmail });
    const tokenRecord = await ForgotPasswordToken.create({
      email: normalizedEmail,
      otp: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    try {
      await otpService.sendPasswordResetOTP(normalizedEmail, otp);
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      await ForgotPasswordToken.findByIdAndDelete(tokenRecord._id);
      throw emailError;
    }

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully to your email',
    });
  } catch (error) {
    console.error('Send forgot password OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ==================== VERIFY FORGOT PASSWORD OTP ====================
export const verifyForgotPasswordOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const tokenRecord = await ForgotPasswordToken.findOne({
      email: normalizedEmail,
      otp: String(otp),
    }).sort({ createdAt: -1 });

    if (!tokenRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
      });
    }

    if (!tokenRecord.isValid()) {
      if (tokenRecord.isUsed) {
        return res.status(400).json({
          success: false,
          message: 'This OTP has already been used',
        });
      }
      if (tokenRecord.isExpired()) {
        return res.status(400).json({
          success: false,
          message: 'OTP has expired. Please request a new one',
        });
      }
    }

    tokenRecord.isUsed = true;
    await tokenRecord.save();

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
    });
  } catch (error) {
    console.error('Verify forgot password OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify OTP. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ==================== RESET PASSWORD ====================
export const resetPassword = async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;

    if (!email || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, new password, and confirm password are required',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    const passwordError = getStrongPasswordError(newPassword);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError,
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const verifiedTokenRecord = await ForgotPasswordToken.findOne({
      email: normalizedEmail,
      isUsed: true,
    }).sort({ createdAt: -1 });

    if (!verifiedTokenRecord || verifiedTokenRecord.isExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Please verify a valid OTP before resetting your password',
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    await ForgotPasswordToken.deleteMany({ email: normalizedEmail });

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ==================== RESEND OTP ====================
export const resendForgotPasswordOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address',
      });
    }

    await ForgotPasswordToken.deleteMany({ email: normalizedEmail });

    const otp = otpService.generateOTP(normalizedEmail);

    const tokenRecord = await ForgotPasswordToken.create({
      email: normalizedEmail,
      otp: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    try {
      await otpService.sendPasswordResetOTP(normalizedEmail, otp);
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      await ForgotPasswordToken.findByIdAndDelete(tokenRecord._id);
      throw emailError;
    }

    return res.status(200).json({
      success: true,
      message: 'New OTP sent successfully',
    });
  } catch (error) {
    console.error('Resend forgot password OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend OTP. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
