/**
 * Razorpay — the two REST calls this site makes, plus signature checks.
 *
 * Called over fetch rather than through the SDK: two endpoints and an HMAC do
 * not justify a dependency, and cold starts stay short.
 *
 * RAZORPAY_KEY_SECRET must never leave this process.
 */

import crypto from 'node:crypto';
import { env, PublicError } from './http.mjs';

var API = 'https://api.razorpay.com/v1';

function authHeader() {
  var pair = env('RAZORPAY_KEY_ID') + ':' + env('RAZORPAY_KEY_SECRET');

  return 'Basic ' + Buffer.from(pair).toString('base64');
}

/**
 * Creates a Razorpay order. The amount comes from our own pricing module —
 * never from the request body.
 *
 * @param {{ amountPaise: number, currency: string, receipt: string, notes: object }} order
 */
export async function createRazorpayOrder(order) {
  var response = await fetch(API + '/orders', {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: order.amountPaise,
      currency: order.currency,
      receipt: order.receipt.slice(0, 40), // Razorpay caps receipts at 40 chars
      notes: order.notes,
      payment_capture: 1
    })
  });

  var body = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    console.error('[razorpay] create order failed', response.status, body);
    throw new PublicError(502, 'We could not start the payment. Please try again.');
  }

  return body;
}

/** Fetches a payment, used by verify to confirm amount and status. */
export async function fetchPayment(paymentId) {
  var response = await fetch(API + '/payments/' + encodeURIComponent(paymentId), {
    headers: { Authorization: authHeader() }
  });

  var body = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    console.error('[razorpay] fetch payment failed', response.status, body);
    throw new PublicError(502, 'We could not confirm the payment. Please try again.');
  }

  return body;
}

/** Constant-time compare of two hex digests of equal expected length. */
function digestsMatch(expected, actual) {
  var a = Buffer.from(String(expected), 'utf8');
  var b = Buffer.from(String(actual), 'utf8');

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/**
 * Verifies the signature Razorpay Checkout hands the browser.
 * Digest is HMAC-SHA256 of "<order_id>|<payment_id>" keyed with the API secret.
 */
export function isValidPaymentSignature(razorpayOrderId, razorpayPaymentId, signature) {
  var expected = crypto
    .createHmac('sha256', env('RAZORPAY_KEY_SECRET'))
    .update(razorpayOrderId + '|' + razorpayPaymentId)
    .digest('hex');

  return digestsMatch(expected, signature);
}

/**
 * Verifies a webhook delivery. Digest is HMAC-SHA256 of the raw request body
 * keyed with the webhook secret — which is a different secret from the API key.
 */
export function isValidWebhookSignature(rawBody, signature) {
  var expected = crypto
    .createHmac('sha256', env('RAZORPAY_WEBHOOK_SECRET'))
    .update(rawBody)
    .digest('hex');

  return digestsMatch(expected, signature);
}
