/**
 * POST /api/razorpay-webhook
 *
 * The reliable half of payment confirmation. /api/verify-payment only runs
 * if the shopper's browser survives long enough to call it; this runs
 * regardless.
 *
 * Configure in the Razorpay dashboard against payment.captured and
 * payment.failed, using RAZORPAY_WEBHOOK_SECRET — a different secret from
 * the API key.
 */

import { json, ok, handle } from './_lib/http.mjs';
import { isValidWebhookSignature } from './_lib/razorpay.mjs';
import { settlePayment, markFailed } from './_lib/orders.mjs';

export default handle('razorpay-webhook', async function (request) {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  // The signature covers the exact bytes sent, so verify before parsing.
  var raw = await request.text();
  var signature = request.headers.get('x-razorpay-signature') || '';

  if (!isValidWebhookSignature(raw, signature)) {
    console.warn('[razorpay-webhook] rejected a delivery with a bad signature');
    return json(401, { error: 'Invalid signature.' });
  }

  var event = JSON.parse(raw);
  var payment = event &&
    event.payload &&
    event.payload.payment &&
    event.payload.payment.entity;

  if (!payment || !payment.order_id) {
    return ok({ received: true, ignored: event && event.event });
  }

  if (event.event === 'payment.captured') {
    await settlePayment(payment.order_id, payment, 'webhook');
  } else if (event.event === 'payment.failed') {
    await markFailed(payment.order_id, payment.error_description);
  }

  // Anything else is acknowledged and ignored, so Razorpay stops retrying.
  return ok({ received: true });
});
