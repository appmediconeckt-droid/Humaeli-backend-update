import QRCode from 'qrcode';
import { doctorProfileUrl } from './qrLinks.js';

// Permanent profile link; clinic changes never change the doctor identifier.
export const generateDoctorQrCode = async (user) => {
  if (user.accountType !== 'doctor') return undefined;
  const payload = doctorProfileUrl(user._id || user.id);
  return QRCode.toDataURL(payload, {
    type: 'image/png',
    errorCorrectionLevel: 'M',
    margin: 4,
    scale: 6,
  });
};
