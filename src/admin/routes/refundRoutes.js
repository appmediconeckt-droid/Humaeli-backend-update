import express from 'express';
import { verifyAdminToken } from '../middleware/simpleAdminAuth.js';
import { approveRefundRequest, getRefundStats, listRefundRequests, markRefundPaid, rejectRefundRequest } from '../controllers/refundController.js';

const router = express.Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
router.get('/', verifyAdminToken, asyncHandler(listRefundRequests));
router.get('/stats', verifyAdminToken, asyncHandler(getRefundStats));
router.put('/:id/approve', verifyAdminToken, asyncHandler(approveRefundRequest));
router.put('/:id/paid', verifyAdminToken, asyncHandler(markRefundPaid));
router.put('/:id/reject', verifyAdminToken, asyncHandler(rejectRefundRequest));
export default router;
