import User from '../models/userModel.js';
import { findNearbyProfessionals, validCoordinates, NEARBY_RADIUS_KM } from '../services/nearbyProfessionals.js';

export const getNearbyProfessionals = async (req, res) => {
  const origin = [req.body?.longitude, req.body?.latitude];
  if (!validCoordinates(origin)) {
    return res.status(400).json({ success: false, message: 'Valid current latitude and longitude are required.' });
  }
  try {
    const professionals = await User.find({
      isActive: true,
      $or: [
        { role: { $in: ['doctor', 'consultant', 'counsellor', 'counselor', 'counsellour'] } },
        { accountType: { $in: ['doctor', 'consultant'] } },
      ],
    }).select('_id locationData.current.coordinates').lean();
    return res.json({ success: true, radiusKm: NEARBY_RADIUS_KM, professionals: findNearbyProfessionals(professionals, origin) });
  } catch (error) {
    console.error('Nearby directory lookup failed:', error);
    return res.status(500).json({ success: false, message: 'Could not load nearby professionals. Please retry.' });
  }
};
