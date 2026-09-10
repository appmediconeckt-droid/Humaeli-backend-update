import Razorpay from 'razorpay';
import crypto from 'crypto';
import User from '../models/userModel.js';
import Transaction from '../models/transactionModel.js';
import CounselorEarning from '../models/CounselorEarning.js';
import dotenv from 'dotenv';
import { createNotificationSafely } from '../services/notificationService.js';
import { creditCapturedWalletPayment } from '../services/walletPaymentService.js';

dotenv.config();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_YOUR_KEY_ID',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'YOUR_KEY_SECRET'
});

const fetchCapturedPayment = async ({ paymentId, orderId }) => {
    if (paymentId) {
        const payment = await razorpay.payments.fetch(paymentId);
        if (String(payment.order_id) !== String(orderId)) {
            throw new Error('Payment does not belong to this wallet order');
        }
        return payment;
    }

    const result = await razorpay.orders.fetchPayments(orderId);
    return result?.items?.find(payment =>
        payment.status === 'captured' || payment.captured === true
    ) || null;
};

const getInstantPayoutConfig = () => {
    const feePercent = Math.max(0, Number(process.env.INSTANT_PAYOUT_FEE_PERCENT || 2));
    const etaMinutes = Math.max(1, Number(process.env.INSTANT_PAYOUT_ETA_MINUTES || 30));
    const standardEtaDays = Math.max(1, Number(process.env.STANDARD_PAYOUT_ETA_DAYS || 3));
    return { feePercent, etaMinutes, standardEtaDays };
};

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const normalizeWithdrawalStatus = (transaction = {}) => {
    const metadataStatus = transaction.metadata?.payoutStatus || transaction.metadata?.approvalStatus;
    const rawStatus = String(metadataStatus || transaction.status || 'pending').toLowerCase();

    if (['completed', 'paid', 'success', 'settled'].includes(rawStatus)) return 'paid';
    if (['hold', 'approved', 'processing', 'processed'].includes(rawStatus)) return 'approved';
    if (['failed', 'rejected', 'cancelled', 'canceled'].includes(rawStatus)) return 'rejected';
    if (rawStatus === 'refunded') return 'refunded';
    return 'pending';
};

const withdrawalStatusMessage = (status) => ({
    pending: 'Waiting for admin approval',
    approved: 'Approved; bank transfer is pending',
    paid: 'Payment sent to bank account',
    rejected: 'Rejected; amount returned to wallet',
    refunded: 'Amount returned to wallet'
}[status] || status);

const clampInteger = (value, fallback, min, max) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const escapeRegex = (value = '') =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Create Razorpay Order
export const createOrder = async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user._id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        const options = {
            amount: amount * 100, // amount in smallest currency unit (paise for INR)
            currency: 'INR',
            receipt: `receipt_${Date.now()}`
        };

        const order = await razorpay.orders.create(options);

        // Save pending transaction
        const transaction = new Transaction({
            userId,
            razorpayOrderId: order.id,
            amount,
            status: 'pending',
            metadata: { walletCreditStatus: 'pending' }
        });
        await transaction.save();

        res.status(200).json({
            success: true,
            order_id: order.id,
            amount: options.amount,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Verify Razorpay Payment
export const verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body;

        const userId = req.user._id;

        const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'YOUR_KEY_SECRET');
        hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
        const generated_signature = hmac.digest('hex');

        if (generated_signature === razorpay_signature) {
            // Payment verified
            const transaction = await Transaction.findOne({
                razorpayOrderId: razorpay_order_id,
                userId
            });
            if (!transaction) {
                return res.status(404).json({ message: 'Transaction not found' });
            }

            transaction.razorpaySignature = razorpay_signature;
            await transaction.save();

            const credit = await creditCapturedWalletPayment({
                transaction,
                paymentId: razorpay_payment_id,
                source: 'checkout_callback'
            });

            if (!credit.alreadyCredited) await createNotificationSafely({
                recipientId: userId,
                type: 'payment',
                title: 'Wallet payment successful',
                message: `₹${transaction.amount.toFixed(2)} was added to your wallet.`,
                data: {
                    transactionId: transaction._id,
                    amount: transaction.amount,
                    transactionType: 'credit',
                    balance: credit.balance
                },
                actionUrl: '/wallet'
            });

            res.status(200).json({
                success: true,
                message: 'Payment verified and wallet updated',
                balance: credit.balance,
                alreadyCredited: credit.alreadyCredited
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid payment signature' });
        }
    } catch (error) {
        console.error('Error verifying Razorpay payment:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// User-triggered recovery for a checkout callback interrupted by a browser or
// network failure.
export const reconcileWalletPayment = async (req, res) => {
    try {
        const userId = req.user._id;
        const orderId = String(req.body.razorpay_order_id || req.body.orderId || '').trim();
        const paymentId = String(req.body.razorpay_payment_id || req.body.paymentId || '').trim();
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'Razorpay Order ID is required' });
        }

        const transaction = await Transaction.findOne({ razorpayOrderId: orderId, userId });
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Wallet payment order not found' });
        }

        const payment = await fetchCapturedPayment({ paymentId, orderId });
        if (!payment || (payment.status !== 'captured' && payment.captured !== true)) {
            return res.status(409).json({
                success: false,
                message: 'Payment is not captured yet. A bank debit may still be automatically reversed.'
            });
        }

        const credit = await creditCapturedWalletPayment({
            transaction,
            paymentId: payment.id,
            source: 'user_reconciliation',
            gatewayPayment: payment
        });

        return res.json({
            success: true,
            message: credit.alreadyCredited
                ? 'Payment was already credited'
                : 'Payment verified and wallet credited',
            balance: credit.balance,
            transaction: credit.transaction
        });
    } catch (error) {
        console.error('Wallet reconciliation error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Could not reconcile payment'
        });
    }
};

// Server-to-server recovery. app.js retains the exact raw JSON body so the
// Razorpay signature can be verified.
export const razorpayWebhook = async (req, res) => {
    try {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
            return res.status(503).json({ success: false, message: 'Webhook secret is not configured' });
        }

        const receivedSignature = String(req.headers['x-razorpay-signature'] || '');
        const rawBody = typeof req.rawBody === 'string'
            ? req.rawBody
            : JSON.stringify(req.body || {});
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');
        const validSignature =
            receivedSignature.length === expectedSignature.length &&
            crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature));

        if (!validSignature) {
            return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }

        const event = String(req.body?.event || '');
        const payment = req.body?.payload?.payment?.entity;
        if (!payment?.order_id) return res.status(200).json({ success: true, ignored: true });

        const transaction = await Transaction.findOne({ razorpayOrderId: payment.order_id });
        if (!transaction) return res.status(200).json({ success: true, ignored: true });

        if (event === 'payment.captured') {
            await creditCapturedWalletPayment({
                transaction,
                paymentId: payment.id,
                source: 'razorpay_webhook',
                gatewayPayment: payment
            });
        } else if (event === 'payment.failed' && transaction.status === 'pending') {
            await Transaction.updateOne(
                { _id: transaction._id, status: 'pending' },
                {
                    $set: {
                        status: 'failed',
                        razorpayPaymentId: payment.id,
                        metadata: {
                            ...(transaction.metadata || {}),
                            walletCreditStatus: 'not_credited',
                            gatewayStatus: 'failed',
                            gatewayErrorCode: payment.error_code || null,
                            gatewayErrorDescription: payment.error_description || null
                        }
                    }
                }
            );
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Razorpay webhook error:', error);
        return res.status(500).json({ success: false, message: 'Webhook processing failed' });
    }
};

// Get Wallet Balance and History
export const getWalletData = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId);
        const transactionFilter = { userId };
        const hasPaginationParams = req.query.page != null || req.query.limit != null;
        const defaultLimit = req.query.from || req.query.to ? 1000 : 50;
        const page = clampInteger(req.query.page, 1, 1, 100000);
        const limit = clampInteger(req.query.limit, defaultLimit, 1, hasPaginationParams ? 100 : defaultLimit);
        const skip = (page - 1) * limit;
        const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000+05:30`) : null;
        const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999+05:30`) : null;
        const type = String(req.query.type || '').trim().toLowerCase();
        const status = String(req.query.status || '').trim().toLowerCase();
        const search = String(req.query.search || '').trim();

        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
            return res.status(400).json({ message: 'Invalid date range' });
        }
        if (from && to && from > to) {
            return res.status(400).json({ message: 'From date cannot be after To date' });
        }
        if (from || to) {
            transactionFilter.createdAt = {};
            if (from) transactionFilter.createdAt.$gte = from;
            if (to) transactionFilter.createdAt.$lte = to;
        }
        if (['credit', 'debit', 'refund'].includes(type)) {
            transactionFilter.type = type;
        }
        if (['pending', 'completed', 'failed', 'hold', 'refunded'].includes(status)) {
            transactionFilter.status = status;
        }
        if (search) {
            const regex = new RegExp(escapeRegex(search), 'i');
            const matchingCounselors = await User.find({ fullName: regex }).select('_id').lean();
            const counselorIds = matchingCounselors.map((counselor) => counselor._id);
            transactionFilter.$or = [
                { description: regex },
                { razorpayPaymentId: regex },
                { razorpayOrderId: regex },
                ...(counselorIds.length ? [{ counselorId: { $in: counselorIds } }] : [])
            ];
        }

        // A selected statement range returns the complete range (up to a safe
        // export limit); the regular wallet view keeps a smaller recent list.
        const [transactions, totalTransactions] = await Promise.all([
            Transaction.find(transactionFilter)
                .populate('counselorId', 'fullName profilePhoto specialization')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Transaction.countDocuments(transactionFilter)
        ]);

        // Calculate Monthly Spending
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const debitDateFilter = from || to
            ? transactionFilter.createdAt
            : { $gte: startOfMonth };
        const monthlyDebits = await Transaction.find({
            userId,
            type: 'debit',
            status: 'completed',
            createdAt: debitDateFilter
        });

        const totalSpent = monthlyDebits.reduce((acc, curr) => acc + curr.amount, 0);

        // Simple grouping for summary (example: based on description)
        const summary = {
            consultations: monthlyDebits
                .filter(d => d.description.toLowerCase().includes('consult'))
                .reduce((acc, curr) => acc + curr.amount, 0),
            other: monthlyDebits
                .filter(d => !d.description.toLowerCase().includes('consult'))
                .reduce((acc, curr) => acc + curr.amount, 0)
        };

        const refundRecords = await Transaction.find({
            userId,
            type: 'refund',
            'metadata.refundRequest': true
        }).sort({ createdAt: -1 }).limit(20).lean();
        const refundRequests = refundRecords.map((item) => ({
            _id: item._id,
            amount: item.amount,
            status: item.metadata?.refundStatus || item.status,
            transactionReference: item.metadata?.transactionReference || null,
            failureReason: item.metadata?.failureReason || null,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
        }));

        res.status(200).json({
            balance: user.walletBalance || 0,
            transactions,
            refundRequests,
            pagination: {
                page,
                limit,
                total: totalTransactions,
                totalPages: Math.max(1, Math.ceil(totalTransactions / limit)),
                hasNextPage: skip + transactions.length < totalTransactions,
                hasPreviousPage: page > 1
            },
            spendingSummary: {
                total: totalSpent,
                period: {
                    from: from?.toISOString() || startOfMonth.toISOString(),
                    to: to?.toISOString() || new Date().toISOString()
                },
                breakdown: [
                    { label: 'Consultations', amount: summary.consultations, percentage: totalSpent > 0 ? (summary.consultations / totalSpent) * 100 : 0 },
                    { label: 'Other', amount: summary.other, percentage: totalSpent > 0 ? (summary.other / totalSpent) * 100 : 0 }
                ]
            }
        });
    } catch (error) {
        console.error('Error fetching wallet data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const requestWalletRefund = async (req, res) => {
    const userId = req.user._id;
    const amount = roundMoney(req.body.amount);
    const accountName = String(req.body.accountName || '').trim();
    const accountNumber = String(req.body.accountNumber || '').replace(/\s+/g, '');
    const ifsc = String(req.body.ifsc || '').trim().toUpperCase();
    const bankName = String(req.body.bankName || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Enter a valid refund amount' });
    }
    if (!accountName || !accountNumber || !ifsc || !bankName) {
        return res.status(400).json({ success: false, message: 'Complete bank details are required' });
    }
    if (!/^\d{8,20}$/.test(accountNumber)) {
        return res.status(400).json({ success: false, message: 'Account number must contain 8 to 20 digits' });
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
        return res.status(400).json({ success: false, message: 'Enter a valid IFSC code' });
    }

    try {
        const existing = await Transaction.findOne({
            userId,
            type: 'refund',
            'metadata.refundRequest': true,
            'metadata.refundStatus': { $in: ['pending', 'approved', 'processing'] }
        }).lean();
        if (existing) {
            return res.status(409).json({ success: false, message: 'A refund request is already under review' });
        }

        const user = await User.findOneAndUpdate(
            { _id: userId, walletBalance: { $gte: amount }, activeWalletRefundRequest: { $ne: true } },
            { $inc: { walletBalance: -amount }, $set: { activeWalletRefundRequest: true } },
            { new: true }
        );
        if (!user) {
            return res.status(409).json({ success: false, message: 'Insufficient balance or a refund request is already under review' });
        }

        let transaction;
        try {
            transaction = await Transaction.create({
                userId,
                amount,
                type: 'refund',
                status: 'hold',
                description: 'Wallet refund request',
                metadata: {
                    refundRequest: true,
                    refundStatus: 'pending',
                    requestedAt: new Date(),
                    processingDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
                    bankDetails: { accountName, accountNumber, ifsc, bankName, last4: accountNumber.slice(-4) }
                }
            });
        } catch (error) {
            await User.updateOne({ _id: userId }, { $inc: { walletBalance: amount }, $set: { activeWalletRefundRequest: false } });
            throw error;
        }

        await createNotificationSafely({
            recipientId: userId,
            type: 'payment',
            title: 'Refund request submitted',
            message: `Your refund request for Rs ${amount.toFixed(2)} is under admin review.`,
            data: { transactionId: transaction._id, amount, refundStatus: 'pending' },
            actionUrl: '/wallet'
        });

        return res.status(201).json({
            success: true,
            message: 'Your refund request was sent to the admin and will be processed within 48 hours.',
            refundRequest: { _id: transaction._id, amount, status: 'pending', createdAt: transaction.createdAt },
            balance: user.walletBalance
        });
    } catch (error) {
        console.error('Wallet refund request error:', error);
        return res.status(500).json({ success: false, message: 'Refund request could not be submitted' });
    }
};

export const notifyWalletRefundStatus = async (req, res) => {
    const suppliedSecret = String(req.headers['x-admin-notification-secret'] || '');
    if (!process.env.ADMIN_JWT_SECRET || suppliedSecret !== process.env.ADMIN_JWT_SECRET) {
        return res.status(401).json({ success: false, message: 'Unauthorized admin notification request' });
    }

    const transactionId = String(req.body.transactionId || '');
    const status = String(req.body.status || '').toLowerCase();
    if (!transactionId || !['approved', 'paid', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Valid transaction and refund status are required' });
    }

    const transaction = await Transaction.findOne({
        _id: transactionId,
        type: 'refund',
        'metadata.refundRequest': true,
        'metadata.refundStatus': status
    }).lean();
    if (!transaction) {
        return res.status(404).json({ success: false, message: 'Matching refund request not found' });
    }

    const content = {
        approved: {
            title: 'Refund request approved',
            message: `Your wallet refund of Rs ${transaction.amount.toFixed(2)} was approved. The bank transfer will be completed within 48 hours.`
        },
        paid: {
            title: 'Refund sent to your bank',
            message: `Your refund of Rs ${transaction.amount.toFixed(2)} has been transferred to your bank account.`
        },
        rejected: {
            title: 'Refund request declined',
            message: `Your refund request for Rs ${transaction.amount.toFixed(2)} was declined and the amount was returned to your wallet.`
        }
    }[status];

    const notification = await createNotificationSafely({
        recipientId: transaction.userId,
        type: 'payment',
        title: content.title,
        message: content.message,
        data: {
            type: 'WALLET_REFUND',
            refundRequestId: transaction._id,
            refundStatus: status,
            amount: transaction.amount
        },
        actionUrl: '/wallet',
        pushType: 'WALLET_REFUND'
    });

    return res.json({ success: true, notificationCreated: Boolean(notification) });
};

export const getCounselorWalletData = async (req, res) => {
    try {
        const counselorId = req.user._id;
        const from = String(req.query.from || '').trim();
        const to = String(req.query.to || '').trim();
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        if ((from && !datePattern.test(from)) || (to && !datePattern.test(to))) {
            return res.status(400).json({ message: 'Dates must use YYYY-MM-DD format' });
        }
        // Dashboard dates are India calendar dates; MongoDB timestamps remain UTC.
        const fromDate = from ? new Date(`${from}T00:00:00.000+05:30`) : null;
        const toDate = to ? new Date(`${to}T23:59:59.999+05:30`) : null;
        if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
            return res.status(400).json({ message: 'Invalid date range' });
        }
        if (fromDate && toDate && fromDate > toDate) {
            return res.status(400).json({ message: 'From date cannot be after To date' });
        }
        const createdAt = {};
        if (fromDate) createdAt.$gte = fromDate;
        if (toDate) createdAt.$lte = toDate;
        const dateFilter = Object.keys(createdAt).length ? { createdAt } : {};
        const counselor = await User.findById(counselorId).lean();

        let earningQuery = CounselorEarning.find({ counselorId, ...dateFilter })
            // Counselor-facing earnings must never expose the user's real
            // name or profile photo. Only the chosen anonymous handle is sent.
            .populate('userId', 'anonymous')
            .sort({ createdAt: -1 });
        // A selected range explicitly requests the complete period. Keep the
        // default response bounded for the live dashboard.
        if (!from && !to) earningQuery = earningQuery.limit(100);
        const earningRecords = await earningQuery.lean();
        // Older earning records predate earningStatus. If the user's wallet was
        // debited and an earning record exists, the earning itself is complete;
        // payoutStatus only describes withdrawal/settlement.
        const earnings = earningRecords.map((item) => ({
            ...item,
            userId: item.userId ? {
                _id: item.userId._id,
                anonymous: String(item.userId.anonymous || '').trim() || 'Anonymous User'
            } : {
                _id: null,
                anonymous: 'Anonymous User'
            },
            earningStatus: item.earningStatus || 'completed'
        }));

        const withdrawalRecords = await Transaction.find({
            userId: counselorId,
            description: /withdrawal/i,
            ...dateFilter
        }).sort({ createdAt: -1 }).limit(from || to ? 0 : 20).lean();
        // The separate admin backend uses `hold` after approval. Expose a
        // payout-domain status so counselors see Approved instead of the raw
        // accounting status. `paid` is returned only after settlement.
        const withdrawals = withdrawalRecords.map((transaction) => {
            const status = normalizeWithdrawalStatus(transaction);
            return {
                ...transaction,
                rawStatus: transaction.status,
                status,
                statusMessage: withdrawalStatusMessage(status),
                approvedAt: transaction.metadata?.approvedAt || null,
                paidAt: transaction.metadata?.paidAt || null,
                transactionReference: transaction.metadata?.transactionReference || ''
            };
        });

        const totalEarned = earnings.reduce((sum, item) => sum + (item.earningAmount || 0), 0);
        // The counselor wallet is the actual withdrawable amount. Summing all
        // pending earning rows would keep showing already-requested withdrawals.
        const pendingPayout = Number(counselor?.walletBalance || 0);
        const grossRevenue = earnings.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
        const platformCommission = earnings.reduce((sum, item) => sum + (item.commission || 0), 0);
        const commissionRate = Number(process.env.PLATFORM_COMMISSION_PERCENT || 20);
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const monthlyEarned = earnings
            .filter((item) => new Date(item.createdAt) >= monthStart)
            .reduce((sum, item) => sum + (item.earningAmount || 0), 0);
        const instantPayoutCount = Math.max(
            Number(counselor?.instantPayoutCount || 0),
            await Transaction.countDocuments({
                userId: counselorId,
                description: /withdrawal/i,
                'metadata.payoutType': 'instant'
            })
        );
        const payoutConfig = getInstantPayoutConfig();

        res.status(200).json({
            balance: counselor?.walletBalance || 0,
            totalEarned,
            pendingPayout,
            grossRevenue,
            platformCommission,
            monthlyEarned,
            period: {
                from: from || null,
                to: to || null,
                filtered: Boolean(from || to),
                earningCount: earnings.length,
                withdrawalCount: withdrawals.length
            },
            split: {
                counselorPercentage: 100 - commissionRate,
                platformPercentage: commissionRate
            },
            payoutOptions: {
                instant: {
                    available: true,
                    isFirstFree: instantPayoutCount === 0,
                    feePercent: instantPayoutCount === 0 ? 0 : payoutConfig.feePercent,
                    regularFeePercent: payoutConfig.feePercent,
                    etaMinutes: payoutConfig.etaMinutes
                },
                standard: {
                    feePercent: 0,
                    etaDays: payoutConfig.standardEtaDays
                }
            },
            earnings,
            withdrawals,
            payoutAccount: counselor?.payoutAccount?.isVerified ? {
                accountName: counselor.payoutAccount.accountName,
                bankName: counselor.payoutAccount.bankName,
                ifsc: counselor.payoutAccount.ifsc,
                last4: String(counselor.payoutAccount.accountNumber || '').slice(-4),
                isVerified: true,
                verifiedAt: counselor.payoutAccount.verifiedAt
            } : null
        });
    } catch (error) {
        console.error('Error fetching counselor wallet data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const requestWithdrawal = async (req, res) => {
    try {
        const counselorId = req.user._id;
        const amount = Number(req.body.amount);
        const payoutType = req.body.payoutType === 'instant' ? 'instant' : 'standard';

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        const counselor = await User.findById(counselorId);
        if (!counselor) {
            return res.status(404).json({ message: 'Counselor not found' });
        }

        let payoutAccount = counselor.payoutAccount;
        let shouldSavePayoutAccount = false;
        if (!payoutAccount?.isVerified) {
            const accountName = String(req.body.accountName || '').trim();
            const accountNumber = String(req.body.accountNumber || '').replace(/\s+/g, '');
            const ifsc = String(req.body.ifsc || '').trim().toUpperCase();
            const bankName = String(req.body.bankName || '').trim();
            if (!accountName || !accountNumber || !ifsc || !bankName) {
                return res.status(400).json({ message: 'Complete bank details are required for the first withdrawal' });
            }
            if (!/^\d{8,20}$/.test(accountNumber)) {
                return res.status(400).json({ message: 'Enter a valid 8 to 20 digit account number' });
            }
            if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
                return res.status(400).json({ message: 'Enter a valid IFSC code' });
            }
            counselor.payoutAccount = {
                accountName, accountNumber, ifsc, bankName,
                isVerified: true, verifiedAt: new Date()
            };
            payoutAccount = counselor.payoutAccount;
            shouldSavePayoutAccount = true;
        }

        // Sync the counter for accounts that made instant withdrawals before the
        // dedicated counter was introduced, then reserve funds atomically.
        const previousInstantPayouts = payoutType === 'instant'
            ? await Transaction.countDocuments({
                userId: counselorId,
                description: /withdrawal/i,
                'metadata.payoutType': 'instant'
            })
            : 0;
        if (payoutType === 'instant' && counselor.instantPayoutCount == null) {
            await User.updateOne(
                { _id: counselorId, instantPayoutCount: { $exists: false } },
                { $set: { instantPayoutCount: 0 } }
            );
        }
        if (payoutType === 'instant' && previousInstantPayouts > Number(counselor.instantPayoutCount || 0)) {
            await User.updateOne(
                { _id: counselorId },
                { $max: { instantPayoutCount: previousInstantPayouts } }
            );
            counselor.instantPayoutCount = previousInstantPayouts;
        }

        const payoutConfig = getInstantPayoutConfig();
        const isFirstInstantFree = payoutType === 'instant' && Number(counselor.instantPayoutCount || 0) === 0;
        const feePercent = payoutType === 'instant' && !isFirstInstantFree ? payoutConfig.feePercent : 0;
        const feeAmount = roundMoney(amount * feePercent / 100);
        const netAmount = roundMoney(amount - feeAmount);
        if (netAmount <= 0) {
            return res.status(400).json({ message: 'Withdrawal amount must be greater than the instant payout fee' });
        }

        const update = { $inc: { walletBalance: -amount } };
        if (payoutType === 'instant') update.$inc.instantPayoutCount = 1;
        if (shouldSavePayoutAccount) update.$set = { payoutAccount };
        if (!payoutAccount?.isVerified) {
            return res.status(400).json({ message: 'A verified payout account is required' });
        }
        const withdrawalFilter = { _id: counselorId, walletBalance: { $gte: amount } };
        if (payoutType === 'instant') {
            withdrawalFilter.instantPayoutCount = Number(counselor.instantPayoutCount || 0);
        }
        const updatedCounselor = await User.findOneAndUpdate(
            withdrawalFilter,
            update,
            { new: true }
        );
        if (!updatedCounselor) {
            return res.status(409).json({ message: 'Balance or instant payout eligibility changed. Please refresh and try again.' });
        }

        let transaction;
        try {
            transaction = await Transaction.create({
                userId: counselorId,
                amount,
                status: 'pending',
                type: 'debit',
                description: 'Counselor withdrawal request',
                metadata: {
                    accountName: payoutAccount.accountName,
                    accountNumber: payoutAccount.accountNumber,
                    ifsc: payoutAccount.ifsc,
                    bankName: payoutAccount.bankName,
                    payoutAccountVerified: true,
                    payoutType,
                    payoutStatus: 'pending',
                    approvalStatus: 'pending',
                    requestedAmount: amount,
                    feePercent,
                    feeAmount,
                    netAmount,
                    firstInstantFree: isFirstInstantFree,
                    estimatedArrival: payoutType === 'instant'
                        ? `Within ${payoutConfig.etaMinutes} minutes`
                        : `Within ${payoutConfig.standardEtaDays} business days`
                }
            });
        } catch (transactionError) {
            const rollback = { $inc: { walletBalance: amount } };
            if (payoutType === 'instant') rollback.$inc.instantPayoutCount = -1;
            await User.updateOne({ _id: counselorId }, rollback);
            throw transactionError;
        }

        res.status(200).json({
            success: true,
            message: payoutType === 'instant'
                ? `Instant withdrawal submitted. You will receive ₹${netAmount.toFixed(2)} within ${payoutConfig.etaMinutes} minutes.`
                : 'Standard withdrawal request submitted',
            balance: updatedCounselor.walletBalance,
            withdrawal: transaction,
            payoutSummary: { payoutType, requestedAmount: amount, feePercent, feeAmount, netAmount },
            payoutAccount: {
                accountName: payoutAccount.accountName,
                bankName: payoutAccount.bankName,
                ifsc: payoutAccount.ifsc,
                last4: String(payoutAccount.accountNumber || '').slice(-4),
                isVerified: true
            }
        });
    } catch (error) {
        console.error('Error requesting withdrawal:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
