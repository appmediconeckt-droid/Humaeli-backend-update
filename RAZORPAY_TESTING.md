Razorpay wallet testing
======================

The backend reads `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from `.env` (or your deployed environment). `.env.example` is a template, not the runtime configuration. Keep actual credentials private. Never put the key secret in a frontend environment variable.

1. Restart the backend after changing credentials. Start the frontend with `npm run dev` in `chatbot-frontend`.
2. Log in as a user, open Wallet, and confirm the Razorpay Test Mode message appears.
3. Enter at least INR 100 and select Proceed to Pay. Use Razorpay's test payment details: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/ . Exercise both success and failure on the mock bank page.
4. A successful captured payment must increase the wallet by the order amount and appear as completed in history. Failed and cancelled attempts must not increase the balance.
5. Refresh Wallet after an interrupted callback to reconcile pending captured payments. Repeating verification/reconciliation must not credit the payment twice.

Enable automatic capture in the Razorpay test dashboard. Authorized payments awaiting capture stay pending and are not credited.

Optional recovery webhook: configure `RAZORPAY_WEBHOOK_SECRET` in the backend and point Razorpay test webhooks at your publicly reachable HTTPS `/api/wallet/razorpay-webhook` endpoint. Subscribe to `payment.captured` and `payment.failed`. This secret is separate from the API key secret. Local callback verification works without a webhook.

Automated checks: run `npm run test:single -- test/razorpayCheckout.test.js` from `chatbot-backend`, and `npm run build` from `chatbot-frontend`. These checks do not execute a real gateway transaction.

Provider appointment checkout
-----------------------------

Doctor: Settings -> Payment. Consultant: Settings -> Payment. Enable Credit Card and/or Debit Card and save the private receiving bank account (account holder, bank name, account number, confirmation, IFSC). UPI is a separate option with a receiving UPI ID. These preferences are saved in the backend; bank details are not returned by the patient-facing methods endpoint.

This implementation is for test checkout and receiving-account preferences. It does not initiate provider bank/UPI settlements or verify receiving accounts. Test payments use the platform's Razorpay test account; stored provider bank/UPI details are preferences, not transfer instructions. Automatic settlement is a separate Razorpay Route integration and is outside the current scope.

For a test transaction, use an INR provider fee and test keys. Enable automatic capture. In the patient booking flow, select Credit Card, Debit Card or UPI. Card details are collected only by Razorpay Checkout; UPI app/QR choices depend on Razorpay and the device. Only the selected card type or UPI is configured in Checkout. The backend also verifies the captured method, amount, currency and order ownership before marking an appointment paid. Card number, CVV and UPI PIN are never stored by this app.

The appointment is reserved before checkout. A cancelled checkout leaves it unpaid. Retry from the booking screen or from My Appointments -> Pay Now; the server reuses the existing order. Successful interrupted callbacks can recover through reconciliation and the existing `/api/wallet/razorpay-webhook` (subscribe to `payment.captured`). Appointment payments are stored separately from wallet top-ups and do not add funds to the patient's wallet.

Restart/deploy the backend to register the new `/api/payments` endpoints, and deploy/reload the updated frontend. The MySQL storage driver creates the private payment settings/payment model tables through its existing schema mechanism. Automated payment tests use mocked gateway responses and do not prove a browser transaction or receiving-account verification.

Validation: `npm run test:single -- test/providerPayments.test.js test/providerPaymentRoutes.test.js test/razorpayCheckout.test.js test/authProfileUpdate.test.js test/appointmentSlots.test.js`.
