/**
 * Orders — persistence and the payment/stock state machine.
 *
 * The transitions that matter:
 *
 *   prepaid: pending --(signature verified / webhook)--> paid
 *            stock is decremented exactly once, at that transition, guarded
 *            by a conditional UPDATE (payment_status=eq.pending) so the
 *            browser confirmation and the webhook cannot both do it.
 *
 *   cod:     stock is decremented BEFORE the order row exists (strict,
 *            all-or-nothing), so a COD order that exists always has its
 *            units reserved. Cancelling/returning it puts them back.
 */

import { db, rpc } from './supabase.mjs';

/* ------------------------------------------------------------------ *
 * Creation
 * ------------------------------------------------------------------ */

/**
 * Inserts an order plus its item snapshot. Returns the order row
 * (including its generated TD number).
 */
export async function insertOrder(fields, pricedLines) {
  var rows = await db('POST', 'orders', fields, 'return=representation');
  var order = rows && rows[0];

  if (!order) throw new Error('Order insert returned nothing');

  try {
    await db(
      'POST',
      'order_items',
      pricedLines.map(function (line) {
        return {
          order_id: order.id,
          variant_id: line.variantId,
          sku: line.sku,
          name: line.name,
          size: line.size,
          qty: line.qty,
          unit_price_paise: line.unitPricePaise,
          line_total_paise: line.linePricePaise
        };
      })
    );
  } catch (error) {
    // Keep the order row (it references real money flows); the items are
    // also snapshotted in orders.customer? No — log loudly instead.
    console.error('[orders] item snapshot failed for', order.order_number, error);
  }

  return order;
}

/** Upserts the customer record by phone and returns its id (best-effort). */
export async function upsertCustomer(customer) {
  try {
    var rows = await db(
      'POST',
      'customers?on_conflict=phone',
      {
        phone: customer.phone,
        full_name: customer.fullName,
        email: customer.email || null,
        last_address: {
          addressLine1: customer.addressLine1,
          addressLine2: customer.addressLine2,
          city: customer.city,
          state: customer.state,
          pincode: customer.pincode
        },
        updated_at: new Date().toISOString()
      },
      'resolution=merge-duplicates,return=representation'
    );

    return rows && rows[0] ? rows[0].id : null;
  } catch (error) {
    console.error('[orders] customer upsert failed', error);
    return null; // An order must never fail because CRM bookkeeping did.
  }
}

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

export async function findByRazorpayOrderId(razorpayOrderId) {
  var rows = await db(
    'GET',
    'orders?razorpay_order_id=eq.' + encodeURIComponent(razorpayOrderId) + '&select=*&limit=1'
  );

  return rows && rows[0];
}

export async function itemsOf(orderId) {
  return (
    (await db(
      'GET',
      'order_items?order_id=eq.' + encodeURIComponent(orderId) +
        '&select=variant_id,sku,name,size,qty,unit_price_paise,line_total_paise'
    )) || []
  );
}

/* ------------------------------------------------------------------ *
 * Stock
 * ------------------------------------------------------------------ */

function toRpcItems(lines) {
  return lines
    .filter(function (line) {
      return line.variantId || line.variant_id;
    })
    .map(function (line) {
      return { variantId: line.variantId || line.variant_id, qty: line.qty };
    });
}

/** All-or-nothing reserve. Throws OUT_OF_STOCK (in .supabaseBody) on shortfall. */
export function reserveStockStrict(lines) {
  return rpc('decrement_stock', { items: toRpcItems(lines), strict: true });
}

/** Always decrements (floors at 0); returns { short: [...] }. For captured payments. */
export function decrementStockLenient(lines) {
  return rpc('decrement_stock', { items: toRpcItems(lines), strict: false });
}

export function restock(lines) {
  return rpc('restock_items', { items: toRpcItems(lines) });
}

export function isOutOfStockError(error) {
  return Boolean(error && String(error.supabaseBody || '').includes('OUT_OF_STOCK'));
}

/* ------------------------------------------------------------------ *
 * Payment settlement (shared by verify-payment and the webhook)
 * ------------------------------------------------------------------ */

/**
 * Marks a prepaid order paid and decrements stock exactly once.
 * Safe to call twice (browser + webhook): the guarded PATCH matches only
 * payment_status=pending, so the second caller becomes a no-op.
 *
 * @returns the updated order row, or null if it was already settled.
 */
export async function settlePayment(razorpayOrderId, payment, source) {
  var rows = await db(
    'PATCH',
    'orders?razorpay_order_id=eq.' + encodeURIComponent(razorpayOrderId) +
      '&payment_status=eq.pending',
    {
      payment_status: 'paid',
      status: 'confirmed',
      razorpay_payment_id: payment.id,
      rzp_payment_detail: payment.method || null,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    'return=representation'
  );

  var order = rows && rows[0];

  if (!order) return null; // Already settled by the other path.

  // Record the gateway event for reconciliation (best-effort).
  try {
    await db('POST', 'payments', {
      order_id: order.id,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: payment.id,
      amount_paise: payment.amount,
      method: payment.method || null,
      status: payment.status || 'captured',
      source: source,
      raw: payment
    });
  } catch (error) {
    console.error('[orders] payment record failed', error);
  }

  // Money has been captured, so the order stands whatever the shelf says:
  // decrement leniently and flag any shortfall for the owner.
  try {
    var items = await itemsOf(order.id);
    var result = await decrementStockLenient(items);
    var short = result && Array.isArray(result.short) && result.short.length > 0;

    await db(
      'PATCH',
      'orders?id=eq.' + order.id,
      { stock_decremented: true, stock_short: short }
    );
  } catch (error) {
    console.error('[orders] stock decrement failed for', order.order_number, error);
  }

  return order;
}

export async function markFailed(razorpayOrderId, reason) {
  await db(
    'PATCH',
    'orders?razorpay_order_id=eq.' + encodeURIComponent(razorpayOrderId) +
      '&payment_status=eq.pending',
    {
      payment_status: 'failed',
      failure_reason: String(reason || '').slice(0, 500),
      updated_at: new Date().toISOString()
    }
  );
}
