import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const clinicUploadsRoot = fileURLToPath(new URL('../../uploads/', import.meta.url));
export function clinicPhotoPath(file) {
 if (!file) return null;
 if (/^https?:\/\//i.test(file.path || '')) return file.path;
 if (file.path) {
  const relative = path.relative(clinicUploadsRoot, path.resolve(file.path));
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return `/uploads/${relative.split(path.sep).join('/')}`;
 }
 return file.filename ? `/uploads/clinic-photos/${file.filename}` : null;
}
export function serializeClinicPhoto(row) {
 const data = row?.toObject ? row.toObject() : row;
 return { ...data, clinic_photo: data?.clinic_photo || null };
}
