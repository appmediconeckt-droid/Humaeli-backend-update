const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

let app;
before(async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.STAFF_PHOTO_STORAGE;
  const { handleStaffPhotoUpload } = await import('../src/middleware/multerConfig.js');
  const { clinicPhotoPath } = await import('../src/services/clinicPhotoService.js');
  app = express();
  app.use(express.json());
  app.patch('/photo', handleStaffPhotoUpload, (req, res) => res.json({
    photo: req.file ? { path: req.file.path, url: clinicPhotoPath(req.file), size: req.file.size } : null,
    isActive: req.body.isActive,
  }));
});

test('real multipart upload saves an image locally even with Cloudinary configured', async () => {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=', 'base64');
  const response = await request(app).patch('/photo').field('isActive', 'true')
    .attach('profilePhoto', image, { filename: 'staff-upload-check.png', contentType: 'image/png' });
  assert.equal(response.status, 200);
  const savedPath = path.resolve(response.body.photo.path);
  const root = path.resolve(__dirname, '../uploads/profile-photos');
  assert.equal(path.dirname(savedPath), root);
  try {
    assert.deepEqual(await fs.readFile(savedPath), image);
    assert.match(response.body.photo.url, /^\/uploads\/profile-photos\//);
    assert.equal(response.body.isActive, 'true');
  } finally { await fs.unlink(savedPath); }
});
test('invalid image types return a clear validation error', async () => {
  const response = await request(app).patch('/photo')
    .attach('profilePhoto', Buffer.from('text'), { filename: 'staff.txt', contentType: 'text/plain' });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /JPG, PNG or WebP/);
});
test('images larger than 5 MB return a clear size error', async () => {
  const response = await request(app).patch('/photo')
    .attach('profilePhoto', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /5 MB/);
});
test('JSON updates without images continue through the upload middleware', async () => {
  const response = await request(app).patch('/photo').send({ isActive: true });
  assert.equal(response.status, 200);
  assert.equal(response.body.photo, null);
  assert.equal(response.body.isActive, true);
});
