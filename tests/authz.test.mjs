/**
 * Authorization tests — the admin endpoints must refuse anyone who is not
 * a proven admin, whatever the browser claims.
 *
 * These run the real function handlers with fetch stubbed, so what is
 * exercised is the actual code path a request takes in production.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
process.env.RAZORPAY_KEY_SECRET = 'secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';

var adminUpdateOrder = (await import('../netlify/functions/admin-update-order.mjs')).default;
var adminInventory = (await import('../netlify/functions/admin-inventory.mjs')).default;
var verifyPayment = (await import('../netlify/functions/verify-payment.mjs')).default;

var realFetch = globalThis.fetch;

function stubFetch(routes) {
  globalThis.fetch = async function (url, options) {
    var key = Object.keys(routes).find(function (fragment) {
      return String(url).includes(fragment);
    });

    if (!key) throw new Error('Unexpected fetch in test: ' + url);

    var route = routes[key];

    return new Response(JSON.stringify(route.body), {
      status: route.status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function postRequest(payload, token) {
  var headers = { 'Content-Type': 'application/json' };

  if (token) headers.Authorization = 'Bearer ' + token;

  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  });
}

test('admin-update-order without a token is 401', async function () {
  var response = await adminUpdateOrder(postRequest({ orderNumber: 'TD10001' }));

  assert.equal(response.status, 401);
});

test('admin-inventory without a token is 401', async function () {
  var response = await adminInventory(postRequest({ action: 'list' }));

  assert.equal(response.status, 401);
});

test('a valid session WITHOUT a role gets 404, learning nothing', async function () {
  stubFetch({
    '/auth/v1/user': { body: { id: '00000000-0000-0000-0000-000000000001', email: 'x@y.z' } },
    '/rest/v1/user_roles': { body: [] } // signed in, but no role row
  });

  try {
    var response = await adminInventory(postRequest({ action: 'list' }, 'sometoken'));

    assert.equal(response.status, 404);
  } finally {
    restoreFetch();
  }
});

test('a rejected token gets 401', async function () {
  stubFetch({
    '/auth/v1/user': { status: 401, body: { error: 'bad token' } }
  });

  try {
    var response = await adminUpdateOrder(
      postRequest({ orderNumber: 'TD10001' }, 'expired'));

    assert.equal(response.status, 401);
  } finally {
    restoreFetch();
  }
});

test('an admin role passes the gate (and reaches the database)', async function () {
  stubFetch({
    '/auth/v1/user': { body: { id: '00000000-0000-0000-0000-000000000002', email: 'boss@td.in' } },
    '/rest/v1/user_roles': { body: [{ role: 'admin' }] },
    '/rest/v1/products': { body: [] },
    '/rest/v1/product_variants': { body: [] }
  });

  try {
    var response = await adminInventory(postRequest({ action: 'list' }, 'goodtoken'));

    assert.equal(response.status, 200);

    var body = await response.json();

    assert.deepEqual(body, { products: [], variants: [] });
  } finally {
    restoreFetch();
  }
});

test('verify-payment rejects a forged signature outright', async function () {
  var response = await verifyPayment(postRequest({
    orderNumber: 'TD10001',
    razorpayOrderId: 'order_x',
    razorpayPaymentId: 'pay_x',
    razorpaySignature: 'deadbeef'.repeat(8)
  }));

  assert.equal(response.status, 400);

  var body = await response.json();

  assert.match(body.error, /could not verify/i);
});

test('verify-payment rejects an incomplete confirmation', async function () {
  var response = await verifyPayment(postRequest({ orderNumber: 'TD10001' }));

  assert.equal(response.status, 400);
});
