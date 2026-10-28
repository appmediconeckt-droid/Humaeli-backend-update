Doctor appointment wallet
=========================

Doctors can see earnings and transaction history in the sidebar Earnings menu
at /doctor-earnings. Payment Settings contains only payment configuration.
The Earnings page opens the live or demo view containing the latest payment.
Live and Demo buttons show transaction counts and keep their balances separate.
Card/UPI captured payments and patient wallet payments use one AppointmentPayment
per appointment. Amount and commission are stored in paise. Wallet debits use an
atomic balance guard and an idempotency marker, allowing retry after interruption.

New appointment payments have a fixed 20% platform fee and 80% doctor share.
The server snapshots the fee in paise for real card/UPI, patient wallet, and demo
payments. Existing records keep their original fee; historical paid transactions
are not silently repriced. Gateway charges, taxes and monthly subscriptions are
not deducted from the doctor's 80% by this flow. The platform must fund these
separately until an explicit business rule changes that policy.

For local demo card/UPI testing enable DEMO_APPOINTMENT_PAYMENTS=true on the
backend, and VITE_DEMO_CARD_PAYMENTS=true in the frontend development build.
The backend rejects demo payments in production. Demo payments are persisted,
but displayed separately from actual earnings. Old browser-only receipts must
be paid again through the demo checkout to create a server record.

Pending earnings become available after completion. Canceled/rejected/no-show
payments are held for refund review. Refund execution remains separate.

Bank settlement activation (RazorpayX payouts)
--------------------------------------------

This integration uses RazorpayX NEFT payouts from the platform's funded account,
covering both gateway payments and wallet spending. It does not automatically
move Payment Gateway settlement funds into RazorpayX. The platform must arrange
funding and activation with Razorpay. No external transfers are run by tests.

Configure server-only RAZORPAYX_KEY_ID, RAZORPAYX_KEY_SECRET and
RAZORPAYX_ACCOUNT_NUMBER, then set DOCTOR_BANK_PAYOUTS_ENABLED=true only when the
business account, funding, permissions and deployment IP allowlisting are ready.
Until then the UI shows activation pending and bank payout buttons are disabled.
Never use the doctor's bank number for RAZORPAYX_ACCOUNT_NUMBER.

Doctor saves bank details in Payment Settings. Platform operations must onboard
and verify the beneficiary using the RazorpayX dashboard (including bank account
validation and identity review), then an authenticated platform admin links the
reviewed fund account:

PUT /api/payments/providers/:providerId/payout-bank
Body: { "fundAccountId": "fa_..." }

The backend fetches the fund account and checks active status, account number,
IFSC and holder name against saved settings. This match is not a replacement
for provider bank-account validation. Changed bank details require relinking.

Doctor requests each completed appointment settlement using the Earnings page:
POST /api/payments/wallet/:paymentId/settlement
Body: {} to start, or { "checkOnly": true } to reconcile.

The amount is the stored gross minus the stored platform fee. Before sending,
the exact payout request, UUID idempotency key and Processing status are saved.
Timeouts leave funds reserved and reuse that same request. Unknown requests
older than six days require manual reconciliation; never generate a replacement
key without confirming that no payment was made. Bank failures restore the amount
to Available. Failed payouts retain their reference for support review and do
not automatically create another payout. Demo payments cannot be paid out.

A background job checks up to 25 processing records each minute; Check status
also reconciles on demand. Only a provider response matching amount, beneficiary,
currency and reference can mark the payout completed. UTR and settlement time
are stored. A subsequent status check also handles provider reversals.

Operations must monitor unresolved Processing records, provider balances,
reversals and refunds. Payout fees/taxes are additional platform costs.
