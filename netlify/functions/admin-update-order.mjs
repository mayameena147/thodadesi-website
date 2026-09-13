/**
 * POST /api/admin-update-order
 *
 * Fulfilment updates from the admin dashboard.
 *
 * Two separate guards, and the second is the one that matters:
 *   1. js/admin.js hides the dashboard from non-admins. That is presentation.
 *   2. requireAdmin() re-reads the caller's role from user_roles using the
 *      service_role key. A forged role in the browser gets a 404 here.
 *
 * Writable: order status, a narrow set of payment-status corrections,
 * courier, tracking number, note. Amounts, items and the customer address
 * are not editable through this endpoint by anyone.
 *
 * Cancelling or returning an order whose stock was decremented puts the
 * units back on the shelf, once (guarded by stock_decremented).
 */

import { handle, readJson, ok, badRequest, PublicError } from './_lib/http.mjs';
import { requireAdmin } from './_lib/auth.mjs';
import { db } from './_lib/supabase.mjs';
import { itemsOf, restock } from './_lib/orders.mjs';

var ORDER_STATUSES = [
  'pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'
];

// The only payment-status corrections an admin may make by hand:
//   cod  -> paid      (cash collected on delivery)
//   paid -> refunded  (money returned via the Razorpay dashboard)
var PAYMENT_TRANSITIONS = { cod: ['paid'], paid: ['refunded'] };

function optionalText(value, field, max) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  if (typeof value !== 'string' || value.length > max) {
    throw badRequest('Please check the ' + field + ' field.');
  }

  return value.trim();
}

export default handle('admin-update-order', async function (request) {
  var payload = await readJson(request);
  var admin = await requireAdmin(request);

  var orderNumber = String(payload.orderNumber || '').trim();

  if (!/^TD\d{4,10}$/.test(orderNumber)) {
    throw badRequest('Invalid order number.');
  }

  var rows = await db(
    'GET',
    'orders?order_number=eq.' + encodeURIComponent(orderNumber) + '&select=*&limit=1'
  );
  var order = rows && rows[0];

  if (!order) throw new PublicError(404, 'That order was not found.');

  var changes = { updated_at: new Date().toISOString() };

  if (payload.status !== undefined) {
    if (ORDER_STATUSES.indexOf(payload.status) === -1) {
      throw badRequest('Unknown order status.');
    }
    changes.status = payload.status;
  }

  if (payload.paymentStatus !== undefined && payload.paymentStatus !== order.payment_status) {
    var allowed = PAYMENT_TRANSITIONS[order.payment_status] || [];

    if (allowed.indexOf(payload.paymentStatus) === -1) {
      throw badRequest('Payment status cannot change from ' +
        order.payment_status + ' to ' + String(payload.paymentStatus) + '.');
    }
    changes.payment_status = payload.paymentStatus;
  }

  var courier = optionalText(payload.courier, 'courier', 60);
  var tracking = optionalText(payload.trackingNumber, 'tracking number', 80);
  var note = optionalText(payload.adminNote, 'note', 500);

  if (courier !== undefined) changes.courier = courier;
  if (tracking !== undefined) changes.tracking_number = tracking;
  if (note !== undefined) changes.admin_note = note;

  // Restock exactly once when an order leaves the world with units reserved.
  var cancelling =
    (changes.status === 'cancelled' || changes.status === 'returned') &&
    order.status !== 'cancelled' && order.status !== 'returned' &&
    order.stock_decremented;

  if (cancelling) {
    var items = await itemsOf(order.id);
    await restock(items);
    changes.stock_decremented = false;
  }

  var updated = await db(
    'PATCH',
    'orders?id=eq.' + order.id,
    changes,
    'return=representation'
  );

  var result = updated && updated[0];

  console.log('[admin-update-order]', admin.email, 'updated', orderNumber,
    Object.keys(changes).join(','));

  return ok({
    orderNumber: result.order_number,
    status: result.status,
    paymentStatus: result.payment_status,
    courier: result.courier,
    trackingNumber: result.tracking_number,
    adminNote: result.admin_note,
    restocked: Boolean(cancelling)
  });
});
