/**
 * POST /api/admin-inventory
 *
 * Inventory management from the admin dashboard.
 *
 *   { action: 'list' }
 *     -> every product with every variant, stock and active flags
 *        (including inactive ones the public catalogue hides).
 *
 *   { action: 'set-stock', updates: [{ variantId, stockQty }] }
 *     -> sets absolute stock levels.
 *
 *   { action: 'set-product', productId, pricePaise?, active? }
 *     -> the two product fields worth editing from a phone. Everything
 *        else (copy, images, new products) is edited in Supabase's table
 *        editor, which is already a perfectly good CMS for a two-product
 *        catalogue.
 *
 * Guarded by requireAdmin() — see _lib/auth.mjs for why the browser's
 * opinion of its own role is worth nothing here.
 */

import { handle, readJson, ok, badRequest } from './_lib/http.mjs';
import { requireAdmin } from './_lib/auth.mjs';
import { db } from './_lib/supabase.mjs';

async function list() {
  var results = await Promise.all([
    db('GET', 'products?select=id,sku,name,number,category,price_paise,active&order=number.asc'),
    db('GET', 'product_variants?select=id,product_id,size,sku,price_paise,stock_qty,active')
  ]);

  return ok({ products: results[0] || [], variants: results[1] || [] });
}

async function setStock(updates) {
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > 100) {
    throw badRequest('Nothing to update.');
  }

  for (var i = 0; i < updates.length; i++) {
    var update = updates[i] || {};
    var qty = Number(update.stockQty);
    var id = String(update.variantId || '');

    if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(qty) || qty < 0 || qty > 100000) {
      throw badRequest('Invalid stock update.');
    }

    await db(
      'PATCH',
      'product_variants?id=eq.' + id,
      { stock_qty: qty, updated_at: new Date().toISOString() }
    );
  }

  return ok({ updated: updates.length });
}

async function setProduct(payload) {
  var id = String(payload.productId || '');

  if (!/^[0-9a-f-]{36}$/.test(id)) throw badRequest('Invalid product.');

  var changes = { updated_at: new Date().toISOString() };

  if (payload.pricePaise !== undefined) {
    var price = Number(payload.pricePaise);

    if (!Number.isInteger(price) || price < 100 || price > 100000000) {
      throw badRequest('Invalid price.');
    }
    changes.price_paise = price;
  }

  if (payload.active !== undefined) changes.active = Boolean(payload.active);

  var rows = await db('PATCH', 'products?id=eq.' + id, changes, 'return=representation');

  return ok({ product: rows && rows[0] });
}

export default handle('admin-inventory', async function (request) {
  var payload = await readJson(request);
  var admin = await requireAdmin(request);

  var action = String(payload.action || '');

  if (action === 'list') return list();

  if (action === 'set-stock') {
    console.log('[admin-inventory]', admin.email, 'set stock');
    return setStock(payload.updates);
  }

  if (action === 'set-product') {
    console.log('[admin-inventory]', admin.email, 'edited product', payload.productId);
    return setProduct(payload);
  }

  throw badRequest('Unknown action.');
});
