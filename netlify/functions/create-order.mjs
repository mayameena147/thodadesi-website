/**
 * POST /api/create-order   (prepaid / Razorpay)
 *
 * The only place a prepaid order's amount is decided.
 *
 * The browser sends [{ sku, size, qty }] and an address. Nothing else from
 * the request is trusted — there is no "amount" field to tamper with.
 * Prices and stock are re-read from Supabase and the total is recomputed
 * with the same pricing module the browser uses for display.
 *
 * Stock is CHECKED here (fail fast before the shopper types an OTP) but
 * only decremented when the payment is actually captured — see
 * _lib/orders.mjs settlePayment().
 *
 * Request : { items: [{ sku, size, qty }], customer: {...} }
 * Response: { orderNumber, razorpayOrderId, amountPaise, currency, keyId }
 */

import { handle, readJson, ok, env, badRequest } from './_lib/http.mjs';
import { validateCustomer, validateItems } from './_lib/validate.mjs';
import { createRazorpayOrder } from './_lib/razorpay.mjs';
import { loadCatalogFromDb } from './_lib/catalog.mjs';
import { totalFor, PricingError } from '../../js/lib/pricing.js';
import { insertOrder, upsertCustomer } from './_lib/orders.mjs';

export default handle('create-order', async function (request) {
  var payload = await readJson(request);

  var items = validateItems(payload.items);
  var customer = validateCustomer(payload.customer);

  var catalog = await loadCatalogFromDb();
  var priced;

  try {
    priced = totalFor(catalog, items, true); // true = check stock
  } catch (error) {
    if (error instanceof PricingError) throw badRequest(error.message);
    throw error;
  }

  var razorpayOrder = await createRazorpayOrder({
    amountPaise: priced.totalPaise,
    currency: catalog.currency,
    receipt: 'td-' + Date.now().toString(36),
    notes: {
      customerName: customer.fullName,
      customerPhone: customer.phone
    }
  });

  var customerId = await upsertCustomer(customer);

  // Recorded before the shopper can pay. If this throws we fail closed: an
  // unpaid Razorpay order costs nothing, an untracked payment costs a lot.
  var order = await insertOrder(
    {
      payment_method: 'prepaid',
      payment_status: 'pending',
      status: 'pending',
      razorpay_order_id: razorpayOrder.id,
      customer_id: customerId,
      customer: customer,
      currency: catalog.currency,
      subtotal_paise: priced.subtotalPaise,
      shipping_paise: priced.shippingPaise,
      total_paise: priced.totalPaise
    },
    priced.lines
  );

  return ok({
    orderNumber: order.order_number,
    razorpayOrderId: razorpayOrder.id,
    amountPaise: priced.totalPaise,
    currency: catalog.currency,
    keyId: env('RAZORPAY_KEY_ID') // Publishable by design; the secret is not.
  });
});
