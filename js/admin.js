/**
 * Admin dashboard — orders and inventory.
 *
 * What this file is NOT: an authorization check. It decides what to draw,
 * nothing more. Reads are limited by the "admin reads all" RLS policies in
 * supabase/schema.sql, which resolve the caller's role inside the
 * database; writes go to /api/admin-update-order and /api/admin-inventory,
 * which re-read that role with the service_role key. Editing this file in
 * devtools reveals nothing and changes nothing.
 */

import { need, escapeHtml } from './lib/dom.js';
import { formatPaise } from './lib/money.js';
import { getSupabase } from './lib/supabase.js';
import {
  startAuth, onAuthChange, signInWithPassword, signOut, authedFetch
} from './lib/auth.js';

var loading = need('.admin-loading');
var signin = need('.admin-signin');
var signinForm = need('.signin-form');
var signinStatus = need('.signin-status');
var denied = need('.admin-denied');
var panel = need('.admin-panel');
var stats = need('.admin-stats');
var ordersView = need('.admin-view-orders');
var ordersList = need('.admin-orders');
var inventoryView = need('.admin-view-inventory');
var inventoryList = need('.admin-inventory');
var searchInput = need('.admin-search input');
var signoutButton = need('.signout-button');

var ORDER_STATUSES = [
  'pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'
];

var orders = [];
var filter = 'open';
var search = '';
var tab = 'orders';

startAuth();

/* ------------------------------------------------------------------ *
 * Loading data
 * ------------------------------------------------------------------ */

/**
 * Returns rows only for admins — not because of the query, but because
 * row-level security silently filters everything else out. A non-admin
 * gets an empty array, which is why the denied state is driven by an
 * explicit probe against the API instead.
 */
async function fetchOrders() {
  var supabase = await getSupabase();

  var result = await supabase
    .from('orders')
    .select('id, order_number, status, payment_status, payment_method, ' +
            'total_paise, customer, courier, tracking_number, admin_note, ' +
            'stock_short, created_at, paid_at, razorpay_payment_id, ' +
            'order_items ( name, size, qty, unit_price_paise )')
    .order('created_at', { ascending: false })
    .limit(300);

  if (result.error) throw new Error(result.error.message);

  return result.data || [];
}

/** Asked of the server, because the browser has no trustworthy answer. */
async function hasAdminAccess() {
  var response = await authedFetch('/api/admin-inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list' })
  });

  return response.ok;
}

async function fetchInventory() {
  var response = await authedFetch('/api/admin-inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list' })
  });

  if (!response.ok) throw new Error('Could not load inventory.');

  return response.json();
}

/* ------------------------------------------------------------------ *
 * Orders — rendering
 * ------------------------------------------------------------------ */

function matchesFilter(order) {
  if (filter === 'all') return true;
  if (filter === 'open') {
    return ['pending', 'confirmed', 'packed'].indexOf(order.status) !== -1 &&
           order.payment_status !== 'failed';
  }

  return order.status === filter;
}

function matchesSearch(order) {
  if (!search) return true;

  var needle = search.toLowerCase();
  var customer = order.customer || {};

  return (
    order.order_number.toLowerCase().includes(needle) ||
    String(customer.phone || '').includes(needle) ||
    String(customer.fullName || '').toLowerCase().includes(needle) ||
    String(customer.pincode || '').includes(needle)
  );
}

function addressBlock(customer) {
  return [
    customer.addressLine1,
    customer.addressLine2,
    customer.city + ' ' + customer.pincode,
    customer.state
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br>');
}

function paymentBadge(order) {
  var label = order.payment_status;

  if (order.payment_status === 'cod') label = 'COD';
  if (order.payment_status === 'paid') label = 'Paid';

  return '<span class="admin-badge pay-' + escapeHtml(order.payment_status) + '">' +
    escapeHtml(label) + '</span>';
}

function orderMarkup(order) {
  var customer = order.customer || {};

  var lines = (order.order_items || [])
    .map(function (line) {
      return (
        '<li><strong>' + line.qty + '&times;</strong> ' + escapeHtml(line.name) +
        ' <span class="admin-size">' + escapeHtml(line.size) + '</span></li>'
      );
    })
    .join('');

  var options = ORDER_STATUSES.map(function (status) {
    return (
      '<option value="' + status + '"' +
      (status === order.status ? ' selected' : '') + '>' + status + '</option>'
    );
  }).join('');

  var when = new Date(order.created_at)
    .toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  var codCollect = order.payment_status === 'cod'
    ? '<label class="admin-cod-collect"><input type="checkbox" name="codPaid"> COD collected</label>'
    : '';

  return (
    '<article class="admin-order" data-number="' + escapeHtml(order.order_number) + '">' +
      '<div class="admin-order-main">' +
        '<header>' +
          '<strong>' + escapeHtml(order.order_number) + '</strong>' +
          '<span class="admin-badge admin-' + escapeHtml(order.status) + '">' +
            escapeHtml(order.status) + '</span>' +
          paymentBadge(order) +
          (order.stock_short
            ? '<span class="admin-badge admin-alert">stock short</span>'
            : '') +
          '<span class="admin-when">' + escapeHtml(when) + '</span>' +
        '</header>' +

        '<ul class="admin-items">' + lines + '</ul>' +

        '<div class="admin-address">' +
          '<strong>' + escapeHtml(customer.fullName || '') + '</strong>' +
          ' &middot; <a href="tel:+91' + escapeHtml(customer.phone || '') + '">' +
            escapeHtml(customer.phone || '') + '</a><br>' +
          addressBlock(customer) +
        '</div>' +
      '</div>' +

      '<form class="admin-order-form">' +
        '<strong class="admin-amount">' + formatPaise(order.total_paise) + '</strong>' +

        '<label><span>Status</span>' +
          '<select name="status">' + options + '</select></label>' +

        '<label><span>Courier</span>' +
          '<input name="courier" type="text" maxlength="60" value="' +
            escapeHtml(order.courier || '') + '" placeholder="Delhivery"></label>' +

        '<label><span>Tracking</span>' +
          '<input name="trackingNumber" type="text" maxlength="80" value="' +
            escapeHtml(order.tracking_number || '') + '" placeholder="AWB number"></label>' +

        '<label><span>Note</span>' +
          '<input name="adminNote" type="text" maxlength="500" value="' +
            escapeHtml(order.admin_note || '') + '" placeholder="Internal only"></label>' +

        codCollect +

        '<button type="submit">Save</button>' +
        '<span class="admin-order-status" role="status" aria-live="polite"></span>' +
      '</form>' +
    '</article>'
  );
}

function renderOrders() {
  var visible = orders.filter(matchesFilter).filter(matchesSearch);

  var open = orders.filter(function (order) {
    return ['pending', 'confirmed', 'packed'].indexOf(order.status) !== -1 &&
           order.payment_status !== 'failed';
  }).length;

  var collected = orders.reduce(function (sum, order) {
    return order.payment_status === 'paid' ? sum + order.total_paise : sum;
  }, 0);

  var codDue = orders.reduce(function (sum, order) {
    return order.payment_status === 'cod' &&
           ['cancelled', 'returned'].indexOf(order.status) === -1
      ? sum + order.total_paise
      : sum;
  }, 0);

  stats.innerHTML =
    '<div><strong>' + open + '</strong><span>open orders</span></div>' +
    '<div><strong>' + formatPaise(collected) + '</strong><span>collected online</span></div>' +
    '<div><strong>' + formatPaise(codDue) + '</strong><span>COD outstanding</span></div>';

  ordersList.innerHTML = visible.length
    ? visible.map(orderMarkup).join('')
    : '<p class="muted">No orders match.</p>';
}

/* ------------------------------------------------------------------ *
 * Orders — updating
 * ------------------------------------------------------------------ */

ordersList.addEventListener('submit', async function (event) {
  event.preventDefault();

  var form = event.target;
  var card = form.closest('.admin-order');
  var orderNumber = card.dataset.number;
  var status = form.querySelector('.admin-order-status');
  var button = form.querySelector('button');
  var data = new FormData(form);

  button.disabled = true;
  status.className = 'admin-order-status';
  status.textContent = 'Saving…';

  var payload = {
    orderNumber: orderNumber,
    status: data.get('status'),
    courier: String(data.get('courier') || '').trim(),
    trackingNumber: String(data.get('trackingNumber') || '').trim(),
    adminNote: String(data.get('adminNote') || '').trim()
  };

  if (data.get('codPaid')) payload.paymentStatus = 'paid';

  try {
    var response = await authedFetch('/api/admin-update-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    var body = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) throw new Error(body.error || 'Update failed.');

    var order = orders.find(function (entry) {
      return entry.order_number === orderNumber;
    });

    if (order) {
      order.status = body.status;
      order.payment_status = body.paymentStatus;
      order.courier = body.courier;
      order.tracking_number = body.trackingNumber;
      order.admin_note = body.adminNote;
    }

    status.className = 'admin-order-status ok';
    status.textContent = body.restocked ? 'Saved — stock returned' : 'Saved';

    window.setTimeout(renderOrders, 900);
  } catch (error) {
    status.className = 'admin-order-status bad';
    status.textContent = error.message;
    button.disabled = false;
  }
});

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

function inventoryMarkup(data) {
  var byProduct = new Map();

  (data.variants || []).forEach(function (variant) {
    var list = byProduct.get(variant.product_id) || [];
    list.push(variant);
    byProduct.set(variant.product_id, list);
  });

  var SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

  return (data.products || [])
    .map(function (product) {
      var variants = (byProduct.get(product.id) || []).sort(function (a, b) {
        return SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size);
      });

      var cells = variants
        .map(function (variant) {
          return (
            '<label class="stock-cell">' +
              '<span>' + escapeHtml(variant.size) + '</span>' +
              '<input type="number" min="0" max="100000" step="1"' +
              ' value="' + variant.stock_qty + '"' +
              ' data-variant="' + escapeHtml(variant.id) + '">' +
            '</label>'
          );
        })
        .join('');

      return (
        '<form class="admin-stock-row" data-product="' + escapeHtml(product.id) + '">' +
          '<header>' +
            '<strong>' + escapeHtml(product.name) + '</strong>' +
            '<span class="muted">' + escapeHtml(product.sku) + ' &middot; ' +
              formatPaise(product.price_paise) +
              (product.active ? '' : ' &middot; INACTIVE') + '</span>' +
          '</header>' +
          '<div class="stock-cells">' + cells + '</div>' +
          '<button type="submit">Save stock</button>' +
          '<span class="admin-order-status" role="status"></span>' +
        '</form>'
      );
    })
    .join('');
}

async function showInventory() {
  inventoryList.innerHTML = '<p class="muted">Loading…</p>';

  try {
    var data = await fetchInventory();
    inventoryList.innerHTML =
      inventoryMarkup(data) || '<p class="muted">No products.</p>';
  } catch (error) {
    inventoryList.innerHTML = '<p class="muted">' + escapeHtml(error.message) + '</p>';
  }
}

inventoryList.addEventListener('submit', async function (event) {
  event.preventDefault();

  var form = event.target;
  var status = form.querySelector('.admin-order-status');
  var button = form.querySelector('button');

  var updates = Array.prototype.map.call(
    form.querySelectorAll('input[data-variant]'),
    function (input) {
      return {
        variantId: input.dataset.variant,
        stockQty: Number(input.value)
      };
    }
  );

  button.disabled = true;
  status.className = 'admin-order-status';
  status.textContent = 'Saving…';

  try {
    var response = await authedFetch('/api/admin-inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-stock', updates: updates })
    });

    var body = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) throw new Error(body.error || 'Update failed.');

    status.className = 'admin-order-status ok';
    status.textContent = 'Saved';
  } catch (error) {
    status.className = 'admin-order-status bad';
    status.textContent = error.message;
  }

  button.disabled = false;
});

/* ------------------------------------------------------------------ *
 * Tabs, filters, search, sign in/out
 * ------------------------------------------------------------------ */

need('.admin-tabs').addEventListener('click', function (event) {
  var button = event.target.closest('[data-tab]');

  if (!button) return;

  tab = button.dataset.tab;

  Array.prototype.forEach.call(
    need('.admin-tabs').querySelectorAll('button'),
    function (other) {
      other.classList.toggle('selected', other === button);
    }
  );

  ordersView.hidden = tab !== 'orders';
  inventoryView.hidden = tab !== 'inventory';

  if (tab === 'inventory') showInventory();
});

need('.admin-filters').addEventListener('click', function (event) {
  var button = event.target.closest('[data-filter]');

  if (!button) return;

  filter = button.dataset.filter;

  Array.prototype.forEach.call(
    need('.admin-filters').querySelectorAll('button'),
    function (other) {
      other.classList.toggle('selected', other === button);
    }
  );

  renderOrders();
});

searchInput.addEventListener('input', function () {
  search = searchInput.value.trim();
  renderOrders();
});

signinForm.addEventListener('submit', async function (event) {
  event.preventDefault();

  var data = new FormData(signinForm);
  var button = signinForm.querySelector('button');

  button.disabled = true;
  signinStatus.hidden = true;

  try {
    await signInWithPassword(
      String(data.get('email') || '').trim(),
      String(data.get('password') || '')
    );
    // onAuthChange takes it from here.
  } catch (error) {
    signinStatus.textContent = error.message;
    signinStatus.className = 'checkout-status signin-status error';
    signinStatus.hidden = false;
  }

  button.disabled = false;
});

signoutButton.addEventListener('click', function () {
  signOut().then(function () {
    window.location.reload();
  });
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function show(which) {
  loading.hidden = which !== 'loading';
  signin.hidden = which !== 'signin';
  denied.hidden = which !== 'denied';
  panel.hidden = which !== 'panel';
  signoutButton.hidden = which === 'loading' || which === 'signin';
}

onAuthChange(async function (state) {
  if (state.status === 'unknown') {
    show('loading');
    return;
  }

  if (state.status === 'unavailable') {
    show('signin');
    signinStatus.textContent = 'Sign-in is unavailable right now.';
    signinStatus.className = 'checkout-status signin-status error';
    signinStatus.hidden = false;
    return;
  }

  if (state.status !== 'signed-in') {
    show('signin');
    return;
  }

  show('loading');

  try {
    var allowed = await hasAdminAccess();

    if (!allowed) {
      show('denied');
      return;
    }

    orders = await fetchOrders();
    renderOrders();
    show('panel');
  } catch (error) {
    show('denied');
    need('.admin-denied-copy').textContent = error.message;
  }
});
