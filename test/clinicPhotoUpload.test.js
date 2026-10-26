import Appointment from '../src/models/appointmentModel.js';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'node:path';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import clinicRoutes from '../src/routes/clinicRoutes.js';
import { Clinic } from '../src/models/clinicModels.js';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
import { clinicQrRepository } from '../src/services/clinicQrService.js';
import { clinicPhotoPath, clinicUploadsRoot } from '../src/services/clinicPhotoService.js';
const app=express();app.use(express.json());app.use('/api/clinics',clinicRoutes);
describe('Clinic uploaded image persistence and GET responses', () => {
 let token, filePath, record, secret;
 const cloud='https://res.cloudinary.com/test/image/upload/clinic-photos/photo.png';
 beforeEach(() => {
  sinon.stub(Appointment, 'find').returns({select(){return this;},lean:async()=>[]});
  secret=process.env.ACCESS_SECRET;process.env.ACCESS_SECRET='clinic-photo-test';
  token=jwt.sign({userId:'doctor-test',sessionId:'session-test'},process.env.ACCESS_SECRET);
  filePath=cloud;
  record={_id:'clinic-test',doctor_id:'doctor-test',clinic_name:'Test Clinic',clinic_photo:null};
  record.save=async()=>record;
  const doctor={_id:'doctor-test',role:'doctor',isActive:true,isOnline:true,consultationFee:500,consultationCurrency:'INR'};
  sinon.stub(User,'findById').callsFake(()=>Object.assign(Promise.resolve(doctor),{select(){return this;}}));
  sinon.stub(Session,'findOne').resolves({_id:'session-test',isActive:true});
  sinon.stub(Session,'updateOne').resolves({});
  sinon.stub(Clinic,'create').callsFake(async data=>{Object.assign(record,data);return record;});
  sinon.stub(Clinic,'find').returns({sort(){return this;},lean:async()=>[record]});
  sinon.stub(Clinic,'findById').callsFake(()=>Object.assign(Promise.resolve(record),{lean:async()=>record}));
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async sql=>{
   if(sql.includes('GET_LOCK'))return [[{acquired:1}]];
   if(sql.includes('SELECT * FROM doctor_clinic_links'))return [[{id:'link-test',facility_id:'facility-test'}]];
   if(sql.includes('SELECT * FROM qr_codes'))return [[{id:'qr-test'}]];
   return [[]];
  }};
  sinon.stub(clinicQrRepository,'connection').resolves(db);
  const store=(req,file,cb)=>{file.stream.resume();file.stream.on('end',()=>cb(null,{path:filePath,filename:'photo.png',size:5}));};
  sinon.stub(CloudinaryStorage.prototype,'_handleFile').callsFake(store);
  sinon.stub(Object.getPrototypeOf(multer.diskStorage({})),'_handleFile').callsFake(store);
 });
 afterEach(()=>{sinon.restore();if(secret===undefined)delete process.env.ACCESS_SECRET;else process.env.ACCESS_SECRET=secret;});
 const upload=(method='post',field='clinic_photo',type='image/png')=>request(app)[method](method==='post'?'/api/clinics':'/api/clinics/clinic-test').auth(token,{type:'bearer'}).field('clinic_name','Test Clinic').field('phone_number','9876543210').field('location','Pune').attach(field,Buffer.from('photo'),{filename:'photo.png',contentType:type});
 it('preserves the cloud image URL in create, list and single-clinic GET',async()=>{
  const created=await upload();expect(created.status).to.equal(201);expect(created.body.clinic.clinic_photo).to.equal(cloud);
  expect((await request(app).get('/api/clinics')).body.clinics[0].clinic_photo).to.equal(cloud);
  expect((await request(app).get('/api/clinics/clinic-test')).body.clinic.clinic_photo).to.equal(cloud);
 });
 it('replaces the image through PATCH and returns it on the next GET',async()=>{
  const updated=await upload('patch');expect(updated.status).to.equal(200);expect(updated.body.clinic.clinic_photo).to.equal(cloud);
  expect((await request(app).get('/api/clinics')).body.clinics[0].clinic_photo).to.equal(cloud);
 });
 it('keeps the clinic-photos directory for local storage',async()=>{
  filePath=path.join(clinicUploadsRoot,'clinic-photos','photo.png');
  const created=await upload();expect(created.status).to.equal(201);expect(created.body.clinic.clinic_photo).to.equal('/uploads/clinic-photos/photo.png');
 });
 it('preserves legacy local filenames and does not depend on server working directory',()=>{
  expect(clinicPhotoPath({path:path.join(clinicUploadsRoot,'old.png')})).to.equal('/uploads/old.png');
 });
 it('rejects non-image files instead of silently creating a clinic without its image',async()=>{
  const res=await upload('post','clinic_photo','application/pdf');expect(res.status).to.equal(400);expect(res.body.message).to.include('must be an image');expect(Clinic.create.called).to.equal(false);
 });
 it('rejects unexpected file fields with JSON',async()=>{
  const res=await upload('post','wrong');expect(res.status).to.equal(400);expect(res.body.success).to.equal(false);expect(Clinic.create.called).to.equal(false);
 });
 it('returns an explicit null photo for clinics without an image',async()=>{
  const res=await request(app).post('/api/clinics').auth(token,{type:'bearer'}).send({clinic_name:'Test Clinic',phone_number:'9876543210',location:'Pune'});
  expect(res.status).to.equal(201);expect(res.body.clinic.clinic_photo).to.equal(null);
 });
 it('saves an independent clinic fee, preserves it on unrelated edits and resets to the common fee',async()=>{
  const patch=body=>request(app).patch('/api/clinics/clinic-test').auth(token,{type:'bearer'}).send(body);
  expect((await patch({fee:'750.50'})).body.clinic.fee).to.equal(750.5);
  expect((await patch({clinic_name:'Renamed'})).body.clinic.fee).to.equal(750.5);
  expect((await patch({fee:0})).body.clinic.fee).to.equal(0);
  expect((await patch({fee:''})).body.clinic.fee).to.equal(null);
 });
 it('accepts a clinic fee during creation',async()=>{
  const res=await request(app).post('/api/clinics').auth(token,{type:'bearer'}).send({clinic_name:'Test Clinic',phone_number:'9876543210',location:'Pune',fee:'650'});
  expect(res.status).to.equal(201);expect(res.body.clinic.fee).to.equal(650);
 });
 it('rejects invalid fees without changing the clinic',async()=>{
  for(const fee of [-1,'abc',true,{},'12.345',10000000]) {
   const res=await request(app).patch('/api/clinics/clinic-test').auth(token,{type:'bearer'}).send({fee});
   expect(res.status).to.equal(400);expect(record.fee).to.equal(undefined);
  }
 });
});
