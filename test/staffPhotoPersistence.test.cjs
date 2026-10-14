const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/controllers/staffController.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
async function create(file) {
  let persisted, body;
  const context = vm.createContext({
    console, bcrypt: { hash: async () => 'hashed-password' },
    User: { exists: async () => false, create: async data => { persisted = data; return { ...data, toJSON: () => ({ ...data, password: undefined }) }; } },
    staffRoles: ['nurse'], getStrongPasswordError: () => null,
    doctorScope: async () => 'doctor-a', sendStaffWelcomeEmail: async () => {},
    clinicPhotoPath: photo => /^https?:/.test(photo.path) ? photo.path : '/uploads/profile-photos/staff.png',
    pick: (object, fields) => Object.fromEntries(fields.filter(key => object[key] !== undefined).map(key => [key, object[key]])),
    handle: callback => callback,
  });
  vm.runInContext(source, context);
  await vm.runInContext('addStaff', context)({ body: { role: 'nurse', fullName: 'Staff', email: 'staff@example.test', phoneNumber: '9876543210', password: 'Temp@12345' }, file },
    { status() { return this; }, json(data) { body = data; } });
  return { persisted, body };
}
test('uploaded Cloudinary image is persisted and returned to the staff UI', async () => {
  const file = { path: 'https://res.cloudinary.com/example/staff.png', filename: 'profile-photos/staff', mimetype: 'image/png', size: 1234 };
  const { persisted, body } = await create(file);
  assert.equal(persisted.profilePhoto.url, file.path);
  assert.equal(persisted.profilePhoto.publicId, file.filename);
  assert.equal(persisted.profilePhoto.bytes, 1234);
  assert.equal(body.user.profilePhoto.url, file.path);
});
test('local image uses an uploads URL and does not acquire a Cloudinary ID', async () => {
  const { persisted } = await create({ path: '/local/uploads/profile-photos/staff.png', filename: 'staff.png', mimetype: 'image/png', size: 1234 });
  assert.equal(persisted.profilePhoto.url, '/uploads/profile-photos/staff.png');
  assert.equal(persisted.profilePhoto.publicId, null);
});
test('staff creation remains supported without an optional image', async () => {
  const { persisted, body } = await create();
  assert.equal(persisted.profilePhoto, undefined);
  assert.equal(body.success, true);
});
test('frontend uploads the selected file as multipart profilePhoto', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '../../chatbot-frontend/src/Component/DoctorDashboard/DoctorUserManagement/DoctorUserManagement.jsx'), 'utf8');
  const start = frontend.indexOf('let requestBody = staffPayload;');
  const end = frontend.indexOf('const response = await axios.post(', start);
  const photo = new Blob(['image'], { type: 'image/png' });
  const context = vm.createContext({ FormData, staffPhoto: photo, staffPayload: { full_name: 'Staff', role: 'nurse', clinic_id: 'clinic-a' } });
  vm.runInContext(frontend.slice(start, end), context);
  const body = vm.runInContext('requestBody', context);
  assert.equal(body.get('full_name'), 'Staff');
  assert.equal(body.get('clinic_id'), 'clinic-a');
  assert.equal(body.get('profilePhoto').size, photo.size);
});

async function update(file, isActive = 'true') {
  let saved = false, sessionsRevoked = false, body;
  const staff = { _id: 'staff-a', fullName: 'Staff', isActive: true,
    profilePhoto: { url: 'https://example.test/old.png' },
    save: async () => { saved = true; }, toJSON() { return { profilePhoto: this.profilePhoto, isActive: this.isActive }; } };
  const context = vm.createContext({ console,
    User: { findOne: async () => staff }, Session: { updateMany: async () => { sessionsRevoked = true; } },
    staffRoles: ['nurse'], doctorScope: async () => 'doctor-a',
    clinicPhotoPath: file => file.path,
    pick: () => ({}), handle: callback => callback,
    fail: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
  });
  vm.runInContext(source, context);
  await vm.runInContext('updateStaff', context)({ params: { id: 'staff-a' }, body: { isActive }, file, is: () => 'multipart/form-data' }, { json(value) { body = value; } });
  return { saved, body, sessionsRevoked };
}
test('editing replaces the saved profile image and accepts multipart activation fields', async () => {
  const file = { path: 'https://example.test/new.png', filename: 'profile-photos/new', mimetype: 'image/png', size: 4321 };
  const result = await update(file);
  assert.equal(result.saved, true);
  assert.equal(result.body.user.profilePhoto.url, file.path);
  assert.equal(result.body.user.profilePhoto.bytes, 4321);
  assert.equal(result.body.user.isActive, true);
  assert.equal(result.sessionsRevoked, false);
});
test('editing without a new image preserves the existing photo', async () => {
  const result = await update();
  assert.equal(result.body.user.profilePhoto.url, 'https://example.test/old.png');
});
test('editing an image and suspending still invalidates active sessions', async () => {
  const result = await update({ path: 'https://example.test/new.png', filename: 'new', mimetype: 'image/png', size: 123 }, 'false');
  assert.equal(result.body.user.isActive, false);
  assert.equal(result.sessionsRevoked, true);
});
test('edit form sends the photo and status together as multipart', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '../../chatbot-frontend/src/Component/DoctorDashboard/DoctorUserManagement/DoctorUserManagement.jsx'), 'utf8');
  const start = frontend.indexOf('let requestBody = editPayload;');
  const end = frontend.indexOf('const response = await axios.patch(', start);
  const context = vm.createContext({ FormData, editPhoto: new Blob(['photo'], { type: 'image/png' }), editPayload: { fullName: 'Updated staff', isActive: true } });
  vm.runInContext(frontend.slice(start, end), context);
  const body = vm.runInContext('requestBody', context);
  assert.equal(body.get('fullName'), 'Updated staff');
  assert.equal(body.get('isActive'), 'true');
  assert.equal(body.get('profilePhoto').size, 5);
});

test('an unparsed update body produces a useful 400 instead of an internal error', async () => {
  const context = vm.createContext({
    handle: callback => callback,
    fail: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
  });
  vm.runInContext(source, context);
  await assert.rejects(vm.runInContext('updateStaff', context)({ params: { id: 'staff-a' } }, {}), error => error.statusCode === 400);
});
