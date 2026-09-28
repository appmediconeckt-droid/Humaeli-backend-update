import QRCode from 'qrcode';

// A registration snapshot of professional details, not a medical-verification badge.
export const generateDoctorQrCode = async (user) => {
  if (user.accountType !== 'doctor') return undefined;
  const payload = JSON.stringify({
    type: 'doctor',
    id: String(user._id),
    fullName: user.fullName,
    qualification: user.qualification,
    specialization: user.specialization,
  });
  return QRCode.toDataURL(payload, {
    type: 'image/png',
    errorCorrectionLevel: 'M',
    margin: 4,
    scale: 6,
  });
};
