import Transaction from "../models/transactionModel.js";
import { createNotificationSafely } from "./notificationService.js";

export const sendWalletRefundStatusNotification = async (transactionId, status) => {
    const transaction = await Transaction.findOne({
        _id: transactionId,
        type: 'refund',
        'metadata.refundRequest': true,
        'metadata.refundStatus': status
    }).lean();
    if (!transaction) {
        return { success: false, message: 'Matching refund request not found' };
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

    return { success: true, notificationCreated: Boolean(notification) };
};
