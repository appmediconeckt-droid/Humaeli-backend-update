import User from '../models/userModel.js';
import Clinic from '../models/clinicModel.js';
import Appointment from '../models/appointmentModel.js';
import WalkinAppointment from '../models/walkinAppointmentModel.js';
import { handle, doctorScope, receptionistClinicScope, dateOnly, fail, todayIST } from '../utils/clinicAccess.js';
import { normalizeQueueAppointment, isActiveQueueAppointment } from '../services/queueTimingService.js';
import { appointmentPatientPhone } from '../utils/appointmentPatientPhone.js';
const idOf = value => String(value?._id || value?.id || value || '');
const canonicalStatus = value => ['complete','done'].includes(value) ? 'completed' : value === 'cancelled' ? 'canceled' : value;
export const staffAppointments = handle(async (req, res) => {
 const doctorId = await doctorScope(req, req.query?.doctor_id);
 const clinicId = await receptionistClinicScope(req, req.query?.clinic_id);
 const vitalsOnly = req.query?.vitals_only === 'true';
 const today = todayIST();
 const from = req.query?.from ? dateOnly(req.query.from) : '';
 const to = req.query?.to ? dateOnly(req.query.to) : '';
 if (from && to && from > to) throw fail(400, 'Start date must be before end date');
 const page=Number(req.query?.page || 1), limit=Number(req.query?.limit || 10);
 if (!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>50) throw fail(400,'Invalid pagination');
 const status=canonicalStatus(String(req.query?.status || 'all').toLowerCase());
 if (!['all','pending','confirmed','booked','waiting','called','in_progress','completed','canceled','rejected','skipped','no_show'].includes(status)) throw fail(400,'Invalid appointment status');
 const [doctor,clinics]=await Promise.all([User.findOne({_id:doctorId,role:'doctor',isActive:true}).select('fullName'),Clinic.find({doctor_id:doctorId,...(clinicId ? {_id:clinicId} : {})})]);
 if (!doctor) throw fail(404,'Assigned doctor is unavailable');
 if (clinicId && !clinics.some(row=>idOf(row)===clinicId)) throw fail(403,'Clinic does not belong to your doctor');
 const scoped=clinicId ? {clinic_id:clinicId} : {};
 const [online,walkins]=await Promise.all([
  Appointment.find({counselor:doctorId,...scoped,...(vitalsOnly ? {appointment_date:today} : {})}).populate('patient','fullName phoneNumber phone_number phone mobile age gender').lean(),
  WalkinAppointment.find({doctor_id:doctorId,...scoped,...(vitalsOnly ? {appointment_date:today} : {})}).lean(),
 ]);
 const search=String(req.query?.search || '').trim().toLowerCase().slice(0,150);
 const records=[...online.map(row=>({row,source:'online'})),...walkins.map(row=>({row,source:'walkin'}))].map(({row,source})=>{
  const normalized=normalizeQueueAppointment(row,source);
  normalized.status=canonicalStatus(normalized.status);
  normalized.queueStatus=canonicalStatus(normalized.queueStatus);
  const ended = normalized.timing?.endedAt && Number.isFinite(new Date(normalized.timing.endedAt).getTime());
  if (normalized.queueStatus==='completed' || (ended && !['canceled','rejected','skipped','no_show'].includes(normalized.status))) {normalized.status='completed';normalized.queueStatus='completed';}
  return {...normalized, patientName:row.patient?.fullName||row.patient_name||'Patient',phoneNumber:appointmentPatientPhone(row),age:row.patient?.age??row.age,gender:row.patient?.gender||row.gender,symptoms:row.symptoms||'',diagnosis:row.diagnosis||'',advice:row.advice||'',vitals:row.vitals||null};
 }).filter(row=>(!vitalsOnly||(row.date===today&&isActiveQueueAppointment(row)))&&(!from||row.date>=from)&&(!to||row.date<=to)&&(status==='all'||row.status===status||row.queueStatus===status)&&`${row.patientName} ${row.phoneNumber} ${row.token??''}`.toLowerCase().includes(search))
 .sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time)||b.id.localeCompare(a.id));
 res.set('Cache-Control','no-store');
 res.json({success:true,doctor:{id:doctorId,fullName:doctor.fullName},clinics,appointments:records.slice((page-1)*limit,page*limit),total:records.length,page,limit,completed:records.filter(row=>row.status==='completed'||row.queueStatus==='completed').length,updatedAt:new Date().toISOString()});
});
