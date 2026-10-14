import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import Clinic from '../src/models/clinicModel.js';
import Appointment from '../src/models/appointmentModel.js';
import Walkin from '../src/models/walkinAppointmentModel.js';
import { staffAppointments } from '../src/controllers/staffAppointmentsController.js';
const response=()=>({status:sinon.stub().returnsThis(),json:sinon.spy(),set:sinon.spy()});
const chain=rows=>({populate(){return this;},lean:async()=>rows});
describe('Staff appointment history includes completed appointments across dates',()=>{
 afterEach(()=>sinon.restore());
 const prepare=(online,walkins=[])=>{
  sinon.stub(User,'findById').returns({select:async()=>({role:'receptionist',isActive:true,assignedDoctor:'doctor-one',clinic_id:'clinic-one'})});
  sinon.stub(User,'findOne').returns({select:async()=>({fullName:'Dr One'})});
  sinon.stub(Clinic,'find').resolves([{id:'clinic-one',clinic_name:'Clinic One'}]);
  sinon.stub(Appointment,'find').returns(chain(online));
  sinon.stub(Walkin,'find').returns(chain(walkins));
 };
 const online={_id:'online-one',appointment_date:'2026-09-01',status:'completed',patient:{_id:'patient-one',fullName:'Old completed patient',phoneNumber:'9876543210'}};
 const walkin={id:'walkin-one',appointment_date:'2026-10-01',appointment_status:'done',patient_name:'Walk-in patient',clinic_id:'clinic-one'};
 it('returns older completed online and walk-in records without a default today filter',async()=>{
  prepare([online],[walkin]);const res=response();await staffAppointments({userId:'staff',query:{}},res);
  const body=res.json.firstCall.args[0];expect(body.total).to.equal(2);expect(body.completed).to.equal(2);expect(body.appointments.map(row=>row.date)).to.deep.equal(['2026-10-01','2026-09-01']);
  expect(Appointment.find.firstCall.args[0]).to.deep.equal({counselor:'doctor-one',clinic_id:'clinic-one'});
  expect(Walkin.find.firstCall.args[0]).to.deep.equal({doctor_id:'doctor-one',clinic_id:'clinic-one'});
 });
 it('completed filter includes ended consultations and excludes pending appointments',async()=>{
  prepare([online,{...online,_id:'ended',status:'confirmed',consultation_ended_at:'2026-09-01T10:00:00Z'},{...online,_id:'pending',status:'pending'}],[walkin]);
  const res=response();await staffAppointments({userId:'staff',query:{status:'completed'}},res);
  expect(res.json.firstCall.args[0].total).to.equal(3);expect(res.json.firstCall.args[0].appointments.every(row=>row.status==='completed')).to.equal(true);
 });
 it('paginates after filtering without losing older completed records',async()=>{
  prepare(Array.from({length:13},(_,i)=>({...online,_id:`visit-${i}`})));const res=response();await staffAppointments({userId:'staff',query:{page:'2',limit:'10'}},res);
  expect(res.json.firstCall.args[0].total).to.equal(13);expect(res.json.firstCall.args[0].appointments).to.have.length(3);
 });
 it('supports date range, clinic and patient search filters',async()=>{
  prepare([online],[walkin]);const res=response();await staffAppointments({userId:'staff',query:{from:'2026-10-01',to:'2026-10-12',clinic_id:'clinic-one',search:'Walk-in'}},res);
  expect(res.json.firstCall.args[0].total).to.equal(1);expect(Appointment.find.firstCall.args[0].clinic_id).to.equal('clinic-one');
 });
 it('rejects another doctor or unrelated clinic before reading appointment data',async()=>{
  prepare([online]);let res=response();await staffAppointments({userId:'staff',query:{doctor_id:'other'}},res);expect(res.status.calledWith(403)).to.equal(true);expect(Appointment.find.called).to.equal(false);
  res=response();await staffAppointments({userId:'staff',query:{clinic_id:'other'}},res);expect(res.status.calledWith(403)).to.equal(true);expect(Appointment.find.called).to.equal(false);
 });
 it('validates filters and pagination',async()=>{
  prepare([online]);for(const query of [{page:'0'},{status:'invalid'},{from:'2026-10-12',to:'2026-10-01'}]){const res=response();await staffAppointments({userId:'staff',query},res);expect(res.status.calledWith(400)).to.equal(true);}
 });
});
