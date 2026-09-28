import User from "../models/userModel.js";
import Transaction from "../models/transactionModel.js";

const normalizePaymentId = (value) => String(value || "").trim();

/**
 * Credits a captured Razorpay payment exactly once.
 *
 * The payment id is stored on the user in the same atomic update that
 * increments the balance. If the process stops before the transaction is
 * marked completed, retrying will not increment the balance again.
 */
export const creditCapturedWalletPayment = async ({
  transaction,
  paymentId,
  source,
  gatewayPayment = null,
  recoveredBy = null,
}) => {
  const normalizedPaymentId = normalizePaymentId(paymentId);
  if (!transaction || !normalizedPaymentId) {
    throw new Error("Transaction and Razorpay payment ID are required");
  }

  if (
    gatewayPayment?.order_id &&
    String(gatewayPayment.order_id) !== String(transaction.razorpayOrderId)
  ) {
    throw new Error("Razorpay payment does not belong to this order");
  }

  if (
    gatewayPayment?.amount != null &&
    Number(gatewayPayment.amount) !== Math.round(Number(transaction.amount) * 100)
  ) {
    throw new Error("Razorpay payment amount does not match the wallet order");
  }

  if (
    gatewayPayment?.currency &&
    String(gatewayPayment.currency).toUpperCase() !==
      String(transaction.currency || "INR").toUpperCase()
  ) {
    throw new Error("Razorpay payment currency does not match the wallet order");
  }

  const walletUpdate = await User.updateOne(
    {
      _id: transaction.userId,
      walletCreditPaymentIds: { $ne: normalizedPaymentId },
    },
    {
      $inc: { walletBalance: Number(transaction.amount) },
      $addToSet: { walletCreditPaymentIds: normalizedPaymentId },
    },
  );

  const alreadyCredited = walletUpdate.modifiedCount === 0;
  if (alreadyCredited) {
    const userExists = await User.exists({ _id: transaction.userId });
    if (!userExists) throw new Error("Wallet owner not found");
  }

  const creditedAt =
    transaction.metadata?.walletCreditedAt || new Date();
  const metadata = {
    ...(transaction.metadata || {}),
    walletCreditStatus: "credited",
    walletCreditedAt: creditedAt,
    walletCreditSource: source,
    gatewayStatus: gatewayPayment?.status || "captured",
    gatewayCaptured: gatewayPayment?.captured ?? true,
    recoveredBy: recoveredBy || transaction.metadata?.recoveredBy || null,
  };

  const updatedTransaction = await Transaction.findByIdAndUpdate(
    transaction._id,
    {
      $set: {
        razorpayPaymentId: normalizedPaymentId,
        status: "completed",
        metadata,
      },
    },
    { returnDocument: 'after' },
  );

  const user = await User.findById(transaction.userId).select("walletBalance");
  return {
    transaction: updatedTransaction,
    balance: Number(user?.walletBalance || 0),
    alreadyCredited,
  };
};

