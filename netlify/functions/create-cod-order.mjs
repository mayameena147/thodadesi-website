/**
 * POST /api/create-cod-order
 *
 * Cash on delivery. No gateway involved; the risks are different:
 * fake orders and overselling. So the flow is stricter than prepaid:
 *
 *   1. Validate the address and cart shape.
 *   2. Re-price everything against the database.
 *   3. Reserve stock ATOMICALLY, all-or-nothing, BEFORE the order exists.
 *      Two shoppers racing for the last piece: exactly one wins, in the
 *      database, not in JavaScript.
 *   4. Insert the order (payment_status 'cod'). If that insert fails the
 *      reservation is rolled back.
 *
 * Request : { items: [{ sku, size, qty }], customer: {...} }
 * Response: { orderNumber, amountPaise, paymentMethod: 'cod' }
 */

import { handle, readJson, ok, badRequest, PublicError } from './_lib/http.mjs';
import { validateCustomer, validateItems } from './_lib/validate.mjs';
import { loadCatalogFromDb } from './_lib/catalog.mjs';
import { totalFor, PricingError } from '../../js/lib/pricing.js';
import {
  insertOrder, upsertCustomer, reserveStockStrict, restock, isOutOfStockError
} from './_lib/orders.mjs';

export default handle('create-cod-order', async function (request) {
  var payload = await readJson(request);

  var items = validateItems(payload.items);
  var customer = validateCustomer(payload.customer);

  var catalog = await loadCatalogFromDb();

  if (!catalog.codEnabled) {
    throw new PublicError(400, 'Cash on delivery is not available right now.');
  }

  var priced;

  try {
    priced = totalFor(catalog, items, true);
  } catch (error) {
    if (error instanceof PricingError) throw badRequest(error.message);
    throw error;
  }

  // Atomic reserve — the database refuses the whole call on any shortfall.
  try {
    await reserveStockStrict(priced.lines);
  } catch (error) {
    if (isOutOfStockError(error)) {
      throw new PublicError(409,
        'Something in your bag just sold out. Please review your bag and try again.');
    }
    throw error;
  }

  var customerId = await upsertCustomer(customer);
  var order;

  try {
    order = await insertOrder(
      {
        payment_method: 'cod',
        payment_status: 'cod',
        status: 'pending',
        customer_id: customerId,
        customer: customer,
        currency: catalog.currency,
        subtotal_paise: priced.subtotalPaise,
        shipping_paise: priced.shippingPaise,
        total_paise: priced.totalPaise,
        stock_decremented: true
      },
      priced.lines
    );
  } catch (error) {
    // Compensate: the reservation must not outlive a failed order.
    try {
      await restock(priced.lines);
    } catch (restockError) {
      console.error('[create-cod-order] restock after failure ALSO failed', restockError);
    }
    throw error;
  }

  console.log('[create-cod-order]', order.order_number, 'for', customer.phone);

  return ok({
    orderNumber: order.order_number,
    amountPaise: priced.totalPaise,
    currency: catalog.currency,
    paymentMethod: 'cod'
  });
});
