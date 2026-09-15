import { sendWalletRefundStatusNotification } from "../../services/walletRefundNotificationService.js";
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';

const baseFilter = { type: 'refund', 'metadata.refundRequest': true };
const notifyUser = async (transactionId, status) => {
  try {
    await sendWalletRefundStatusNotification(transactionId, status);
  } catch (error) {
    console.warn(`Refund ${status} notification failed:`, error.message);
  }
};
const statusOf = (tx) => String(tx.metadata?.refundStatus || tx.status || 'pending').toLowerCase();
const serialize = (tx) => ({
  _id: tx._id,
  amount: tx.amount,
  currency: tx.currency || 'INR',
  status: statusOf(tx),
  user: tx.userId ? { _id: tx.userId._id, fullName: tx.userId.fullName, email: tx.userId.email, phone: tx.userId.phone || tx.userId.phoneNumber } : null,
  bankDetails: tx.metadata?.bankDetails || {},
  processingDeadline: tx.metadata?.processingDeadline,
  transactionReference: tx.metadata?.transactionReference,
  failureReason: tx.metadata?.failureReason,
  adminNotes: tx.metadata?.adminNotes,
  approvedAt: tx.metadata?.approvedAt,
  paidAt: tx.metadata?.paidAt,
  rejectedAt: tx.metadata?.rejectedAt,
  createdAt: tx.createdAt,
  updatedAt: tx.updatedAt,
});

const audit = (req, tx, details) => AuditLog.create({
  adminEmail: req.user?.email,
  action: 'REFUND',
  entityType: 'TRANSACTION',
  entityId: tx._id,
  entityName: `Wallet refund ${tx._id}`,
  ipAddress: req.ip,
  details,
}).catch(() => null);

export const listRefundRequests = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const status = String(req.query.status || '').trim().toLowerCase();
    const filter = { ...baseFilter };
    if (status) filter['metadata.refundStatus'] = status;
    const [rows, total] = await Promise.all([
      Transaction.find(filter).populate('userId', 'fullName email phone phoneNumber').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Transaction.countDocuments(filter),
    ]);
    return res.json({ success: true, data: rows.map(serialize), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Refund requests could not be loaded' });
  }
};

export const getRefundStats = async (_req, res) => {
  try {
    const rows = await Transaction.aggregate([
      { $match: baseFilter },
      { $group: { _id: '$metadata.refundStatus', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]);
    return res.json({ success: true, data: rows });
  } catch (_) {
    return res.status(500).json({ success: false, message: 'Refund statistics could not be loaded' });
  }
};

export const approveRefundRequest = async (req, res) => {
  const tx = await Transaction.findOneAndUpdate(
    { _id: req.params.id, ...baseFilter, 'metadata.refundStatus': 'pending' },
    { $set: { status: 'hold', 'metadata.refundStatus': 'approved', 'metadata.approvedAt': new Date(), 'metadata.adminNotes': String(req.body.notes || '').trim(), 'metadata.approvedBy': req.user?.email } },
    { returnDocument: 'after' }
  ).populate('userId', 'fullName email phone phoneNumber');
  if (!tx) return res.status(409).json({ success: false, message: 'Only pending refund requests can be approved' });
  await audit(req, tx, 'Wallet refund approved');
  await notifyUser(tx._id, 'approved');
  return res.json({ success: true, message: 'Refund approved; complete the bank transfer within 48 hours', data: serialize(tx) });
};

export const markRefundPaid = async (req, res) => {
  const reference = String(req.body.transactionReference || '').trim();
  if (!reference) return res.status(400).json({ success: false, message: 'Bank transaction reference is required' });
  const tx = await Transaction.findOneAndUpdate(
    { _id: req.params.id, ...baseFilter, 'metadata.refundStatus': { $in: ['approved', 'processing'] } },
    { $set: { status: 'completed', 'metadata.refundStatus': 'paid', 'metadata.paidAt': new Date(), 'metadata.transactionReference': reference, 'metadata.processedBy': req.user?.email } },
    { returnDocument: 'after' }
  ).populate('userId', 'fullName email phone phoneNumber');
  if (!tx) return res.status(409).json({ success: false, message: 'Only approved refunds can be marked paid' });
  await User.updateOne({ _id: tx.userId._id }, { $set: { activeWalletRefundRequest: false } });
  await audit(req, tx, `Wallet refund paid (${reference})`);
  await notifyUser(tx._id, 'paid');
  return res.json({ success: true, message: 'Refund marked as paid', data: serialize(tx) });
};

export const rejectRefundRequest = async (req, res) => {
  const reason = String(req.body.failureReason || req.body.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ success: false, message: 'Rejection reason is required' });
  const tx = await Transaction.findOneAndUpdate(
    { _id: req.params.id, ...baseFilter, 'metadata.refundStatus': { $in: ['pending', 'approved', 'processing'] } },
    { $set: { status: 'refunded', 'metadata.refundStatus': 'rejected', 'metadata.rejectedAt': new Date(), 'metadata.failureReason': reason, 'metadata.rejectedBy': req.user?.email } },
    { returnDocument: 'after' }
  ).populate('userId', 'fullName email phone phoneNumber');
  if (!tx) return res.status(409).json({ success: false, message: 'This refund request is already finalized' });
  await User.updateOne(
    { _id: tx.userId._id },
    { $inc: { walletBalance: tx.amount }, $set: { activeWalletRefundRequest: false } }
  );
  await audit(req, tx, `Wallet refund rejected; Rs ${tx.amount} returned to wallet`);
  await notifyUser(tx._id, 'rejected');
  return res.json({ success: true, message: 'Request rejected and amount returned to the user wallet', data: serialize(tx) });
};
