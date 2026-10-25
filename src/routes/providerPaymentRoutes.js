import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { getOwnPaymentSettings, saveOwnPaymentSettings, getProviderPaymentMethods } from '../controllers/providerPaymentSettingsController.js';
import { createAppointmentPaymentOrder, verifyAppointmentPayment, reconcileAppointmentPayment } from '../controllers/appointmentPaymentController.js';

const router = Router();
router.use(authMiddleware);
router.get('/preferences', getOwnPaymentSettings);
router.put('/preferences', saveOwnPaymentSettings);
router.get('/providers/:providerId/methods', getProviderPaymentMethods);
router.post('/appointments/:appointmentId/order', createAppointmentPaymentOrder);
router.post('/appointments/:appointmentId/verify', verifyAppointmentPayment);
router.post('/appointments/:appointmentId/reconcile', reconcileAppointmentPayment);
export default router;
