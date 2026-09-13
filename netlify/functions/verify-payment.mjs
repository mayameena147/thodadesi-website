/**
 * POST /api/verify-payment
 *
 * Confirms a payment the browser says succeeded. Three checks, in order:
 *
 *   1. The signature is a valid HMAC of "<order_id>|<payment_id>" under our
 *      API secret — proof the response came from Razorpay, not the console.
 *   2. The order exists here and the number matches.
 *   3. Razorpay's own record of the payment is captured/authorized and for
 *      the amount we asked for — belt and braces against a replayed
 *      signature.
 *
 * Settlement (mark paid + decrement stock) is guarded so this and the
 * webhook can both run without double-writing. The webhook exists because a
 * shopper can close the tab before this call is ever made.
 */

import { handle, readJson, ok, badRequest, PublicError } from './_lib/http.mjs';
import { isValidPaymentSignature, fetchPayment } from './_lib/razorpay.mjs';
import { findByRazorpayOrderId, settlePayment } from './_lib/orders.mjs';

export default handle('verify-payment', async function (request) {
  var payload = await readJson(request);

  var razorpayOrderId = String(payload.razorpayOrderId || '');
  var razorpayPaymentId = String(payload.razorpayPaymentId || '');
  var razorpaySignature = String(payload.razorpaySignature || '');
  var orderNumber = String(payload.orderNumber || '');

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw badRequest('Incomplete payment confirmation.');
  }

  if (!isValidPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    console.warn('[verify-payment] signature mismatch for', razorpayOrderId);
    throw new PublicError(400, 'We could not verify this payment.');
  }

  var order = await findByRazorpayOrderId(razorpayOrderId);

  if (!order || order.order_number !== orderNumber) {
    throw new PublicError(404, 'We could not find that order.');
  }

  var payment = await fetchPayment(razorpayPaymentId);

  if (payment.order_id !== razorpayOrderId) {
    throw new PublicError(400, 'We could not verify this payment.');
  }

  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    throw new PublicError(400, 'This payment has not completed.');
  }

  if (payment.amount !== order.total_paise) {
    console.error('[verify-payment] amount mismatch', razorpayOrderId, payment.amount);
    throw new PublicError(400, 'We could not verify this payment.');
  }

  // No-op if the webhook already settled it.
  await settlePayment(razorpayOrderId, payment, 'verify-payment');

  return ok({ orderNumber: order.order_number, paymentStatus: 'paid' });
});
