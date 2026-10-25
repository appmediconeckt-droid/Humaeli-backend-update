export const NEARBY_RADIUS_KM = 25;

export const validCoordinates = (value) => Array.isArray(value) && value.length === 2 &&
  value.every((part) => typeof part === 'number' && Number.isFinite(part)) &&
  Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

export const distanceKm = (from, to) => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to[1] - from[1]);
  const longitudeDelta = radians(to[0] - from[0]);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(from[1])) *
    Math.cos(radians(to[1])) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
};

export const findNearbyProfessionals = (professionals, origin) => {
  if (!validCoordinates(origin)) return [];
  return professionals.flatMap((professional) => {
    const point = professional.locationData?.current?.coordinates;
    if (!validCoordinates(point)) return [];
    const distance = distanceKm(origin, point);
    return distance <= NEARBY_RADIUS_KM ? [{ id: String(professional._id), distanceKm: distance }] : [];
  }).sort((a, b) => a.distanceKm - b.distanceKm);
};
