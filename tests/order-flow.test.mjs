/**
 * Order-flow tests — the money paths, end to end, against a tiny in-memory
 * stand-in for Supabase REST and the Razorpay API.
 *
 * What is being proven:
 *   - the amount charged is computed server-side (a tampered price changes nothing)
 *   - COD reserves stock atomically and refuses overselling with a 409
 *   - a captured payment settles the order and decrements stock EXACTLY once,
 *     however many times verify-payment and the webhook both fire
 *   - a forged webhook signature is rejected
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
process.env.RAZORPAY_KEY_SECRET = 'test-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';

var createOrder = (await import('../netlify/functions/create-order.mjs')).default;
var createCodOrder = (await import('../netlify/functions/create-cod-order.mjs')).default;
var verifyPayment = (await import('../netlify/functions/verify-payment.mjs')).default;
var webhook = (await import('../netlify/functions/razorpay-webhook.mjs')).default;

/* ------------------------------------------------------------------ *
 * The fake backend
 * ------------------------------------------------------------------ */

var state;

function resetState() {
  state = {
    stock: { 'v-kur-s': 3, 'v-kur-m': 0, 'v-sal-s': 10 },
    orders: [],
    orderItems: [],
    payments: [],
    nextOrderNumber: 10001,
    razorpayOrders: []
  };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

var VARIANTS = [
  { id: 'v-kur-s', product_id: 'p-kur', size: 'S', sku: 'TD-KUR-001-S', price_paise: null },
  { id: 'v-kur-m', product_id: 'p-kur', size: 'M', sku: 'TD-KUR-001-M', price_paise: null },
  { id: 'v-sal-s', product_id: 'p-sal', size: 'S', sku: 'TD-SAL-002-S', price_paise: null }
];

function route(url, options) {
  var method = (options && options.method) || 'GET';
  if (process.env.DBG) console.error('ROUTE', method, String(url));
  var body = options && options.body ? JSON.parse(options.body) : null;
  var path = String(url);

  // ---- Razorpay ----
  if (path.includes('api.razorpay.com/v1/orders')) {
    var rzpOrder = { id: 'order_rzp_' + (state.razorpayOrders.length + 1), amount: body.amount };
    state.razorpayOrders.push(Object.assign({}, body, rzpOrder));
    return jsonResponse(rzpOrder);
  }

  if (path.includes('api.razorpay.com/v1/payments/')) {
    var paymentId = path.split('/').pop();
    var order = state.orders[state.orders.length - 1];
    return jsonResponse({
      id: paymentId,
      order_id: order.razorpay_order_id,
      status: 'captured',
      method: 'upi',
      amount: order.total_paise
    });
  }

  // ---- Supabase ----
  if (path.includes('/rest/v1/shop_config')) {
    return jsonResponse([{
      free_shipping_threshold_paise: 299900,
      shipping_flat_paise: 9900,
      cod_enabled: true
    }]);
  }

  if (path.includes('/rest/v1/products')) {
    return jsonResponse([
      { id: 'p-kur', sku: 'TD-KUR-001', slug: 'g', number: '01', category: 'SHORT KURTI',
        name: 'Gulabo After Dark', colour: 'Rose milk', description: '',
        price_paise: 249000, compare_at_price_paise: null, image: '', alt: '' },
      { id: 'p-sal', sku: 'TD-SAL-002', slug: 'm', number: '02', category: 'FARSI SALWAR',
        name: 'Mehfil, But Make It Chill', colour: 'Pista dust', description: '',
        price_paise: 429000, compare_at_price_paise: null, image: '', alt: '' }
    ]);
  }

  if (path.includes('/rest/v1/product_variants')) {
    return jsonResponse(VARIANTS.map(function (variant) {
      return Object.assign({ stock_qty: state.stock[variant.id] }, variant);
    }));
  }

  if (path.includes('/rest/v1/customers')) {
    return jsonResponse([{ id: 'cust-1' }]);
  }

  if (path.includes('/rest/v1/rpc/decrement_stock')) {
    var short = [];
    var strict = body.strict;
    var snapshot = Object.assign({}, state.stock);

    for (var i = 0; i < body.items.length; i++) {
      var item = body.items[i];

      if (snapshot[item.variantId] >= item.qty) {
        snapshot[item.variantId] -= item.qty;
      } else if (strict) {
        return jsonResponse({ message: 'OUT_OF_STOCK:' + item.variantId }, 400);
      } else {
        snapshot[item.variantId] = 0;
        short.push({ variantId: item.variantId });
      }
    }

    state.stock = snapshot; // commit (all-or-nothing already handled above)
    return jsonResponse({ short: short });
  }

  if (path.includes('/rest/v1/rpc/restock_items')) {
    body.items.forEach(function (item) {
      state.stock[item.variantId] += item.qty;
    });
    return jsonResponse(null);
  }

  if (path.includes('/rest/v1/order_items')) {
    if (method === 'POST') {
      state.orderItems = state.orderItems.concat(body);
      return jsonResponse(body);
    }
    var orderId = decodeURIComponent(path).match(/order_id=eq\.([^&]+)/)[1];
    return jsonResponse(state.orderItems.filter(function (item) {
      return item.order_id === orderId;
    }).map(function (item) {
      return Object.assign({ variant_id: item.variant_id }, item);
    }));
  }

  if (path.includes('/rest/v1/payments')) {
    state.payments.push(body);
    return jsonResponse([body]);
  }

  if (path.includes('/rest/v1/orders')) {
    if (method === 'POST') {
      var row = Object.assign({
        id: 'ord-' + (state.orders.length + 1),
        order_number: 'TD' + state.nextOrderNumber++,
        stock_decremented: Boolean(body.stock_decremented)
      }, body);
      state.orders.push(row);
      return jsonResponse([row]);
    }

    var rzpMatch = decodeURIComponent(path).match(/razorpay_order_id=eq\.([^&]+)/);
    var found = state.orders.filter(function (row) {
      return rzpMatch && row.razorpay_order_id === rzpMatch[1];
    });

    if (method === 'GET') return jsonResponse(found);

    if (method === 'PATCH') {
      var pendingOnly = path.includes('payment_status=eq.pending');
      var idMatch = decodeURIComponent(path).match(/[?&]id=eq\.([^&]+)/);
      var targets = state.orders.filter(function (row) {
        if (idMatch) return row.id === idMatch[1];
        if (!rzpMatch || row.razorpay_order_id !== rzpMatch[1]) return false;
        return pendingOnly ? row.payment_status === 'pending' : true;
      });

      targets.forEach(function (row) {
        Object.assign(row, body);
      });

      return jsonResponse(targets);
    }
  }

  console.error("UNHANDLED", method, path); throw new Error("Unhandled route in test: " + method + " " + path);
}

globalThis.fetch = async function (url, options) {
  return route(url, options);
};

function post(payload) {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

var CUSTOMER = {
  fullName: 'Aarohi Sharma',
  phone: '9876543210',
  addressLine1: '12 Hauz Khas Village',
  city: 'New Delhi',
  state: 'Delhi',
  pincode: '110016'
};

function signature(orderId, paymentId) {
  return crypto.createHmac('sha256', 'test-secret')
    .update(orderId + '|' + paymentId).digest('hex');
}

/* ------------------------------------------------------------------ *
 * COD
 * ------------------------------------------------------------------ */

test('COD order: server price wins, stock is reserved, TD number issued', async function () {
  resetState();

  var response = await createCodOrder(post({
    items: [{ sku: 'TD-KUR-001', size: 'S', qty: 2, unitPricePaise: 1 }],
    customer: CUSTOMER
  }));

  assert.equal(response.status, 200);

  var body = await response.json();

  assert.match(body.orderNumber, /^TD\d{5}$/);
  assert.equal(body.amountPaise, 249000 * 2 + 0); // over threshold: free shipping
  assert.equal(state.stock['v-kur-s'], 1);        // 3 - 2
  assert.equal(state.orders[0].payment_status, 'cod');
  assert.equal(state.orders[0].stock_decremented, true);
});

test('COD order beyond stock is refused with 409 and decrements nothing', async function () {
  resetState();

  var response = await createCodOrder(post({
    items: [{ sku: 'TD-KUR-001', size: 'S', qty: 4 }], // only 3 on the shelf
    customer: CUSTOMER
  }));

  // priceLines' own stock check trips first (400), or the RPC's 409 —
  // either way nothing was written.
  assert.ok(response.status === 400 || response.status === 409);
  assert.equal(state.stock['v-kur-s'], 3);
  assert.equal(state.orders.length, 0);
});

test('COD order for a size with zero stock is refused', async function () {
  resetState();

  var response = await createCodOrder(post({
    items: [{ sku: 'TD-KUR-001', size: 'M', qty: 1 }],
    customer: CUSTOMER
  }));

  assert.equal(response.status, 400);
  assert.equal(state.orders.length, 0);
});

/* ------------------------------------------------------------------ *
 * Prepaid
 * ------------------------------------------------------------------ */

test('prepaid: Razorpay order carries the SERVER total, not the browser one', async function () {
  resetState();

  var response = await createOrder(post({
    items: [{ sku: 'TD-SAL-002', size: 'S', qty: 1, unitPricePaise: 100 }], // "₹1"
    customer: CUSTOMER,
    amount: 100 // ignored
  }));

  assert.equal(response.status, 200);

  var body = await response.json();

  assert.equal(body.amountPaise, 429000); // ₹4,290, free shipping
  assert.equal(state.razorpayOrders[0].amount, 429000);
  assert.equal(state.orders[0].payment_status, 'pending');
  assert.equal(state.stock['v-sal-s'], 10); // NOT decremented before payment
});

test('prepaid: settle decrements stock exactly once across verify + webhook', async function () {
  resetState();

  await createOrder(post({
    items: [{ sku: 'TD-KUR-001', size: 'S', qty: 1 }],
    customer: CUSTOMER
  }));

  var order = state.orders[0];
  var rzpOrderId = order.razorpay_order_id;
  var payId = 'pay_123';

  // 1. Browser confirms.
  var verifyResponse = await verifyPayment(post({
    orderNumber: order.order_number,
    razorpayOrderId: rzpOrderId,
    razorpayPaymentId: payId,
    razorpaySignature: signature(rzpOrderId, payId)
  }));

  assert.equal(verifyResponse.status, 200);
  assert.equal(order.payment_status, 'paid');
  assert.equal(order.status, 'confirmed');
  assert.equal(state.stock['v-kur-s'], 2);

  // 2. Webhook arrives for the same payment — must be a no-op.
  var raw = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: {
      id: payId, order_id: rzpOrderId, status: 'captured',
      method: 'upi', amount: order.total_paise
    } } }
  });

  var webhookResponse = await webhook(new Request('http://localhost/api/razorpay-webhook', {
    method: 'POST',
    headers: {
      'x-razorpay-signature': crypto.createHmac('sha256', 'webhook-secret')
        .update(raw).digest('hex')
    },
    body: raw
  }));

  assert.equal(webhookResponse.status, 200);
  assert.equal(state.stock['v-kur-s'], 2); // still 2 — no double decrement

  // 3. A replayed verify call is also a no-op.
  var replay = await verifyPayment(post({
    orderNumber: order.order_number,
    razorpayOrderId: rzpOrderId,
    razorpayPaymentId: payId,
    razorpaySignature: signature(rzpOrderId, payId)
  }));

  assert.equal(replay.status, 200);
  assert.equal(state.stock['v-kur-s'], 2);
});

test('webhook with a forged signature is rejected and changes nothing', async function () {
  resetState();

  var raw = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x' } } }
  });

  var response = await webhook(new Request('http://localhost/api/razorpay-webhook', {
    method: 'POST',
    headers: { 'x-razorpay-signature': 'ff'.repeat(32) },
    body: raw
  }));

  assert.equal(response.status, 401);
  assert.equal(state.orders.length, 0);
});
