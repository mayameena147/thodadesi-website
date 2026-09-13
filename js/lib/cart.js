/**
 * Cart — the browser's copy of what the shopper has picked.
 *
 * Stores only { sku, size, qty }. Prices are never persisted: they are
 * looked up from the catalogue for display and recomputed server-side at
 * checkout, so an edited localStorage entry changes nothing about what
 * gets charged.
 *
 * Survives refreshes, stays in sync across tabs, and notifies subscribers
 * on every change.
 */

import { LIMITS, totalFor, findProduct, findSize } from './pricing.js';

var STORAGE_KEY = 'thodadesi.cart.v1';

var listeners = new Set();
var lines = read();

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/** Reads and sanitises the stored cart. Anything malformed is discarded. */
function read() {
  var raw;

  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return []; // Private mode, or storage disabled. Cart is in-memory only.
  }

  if (!raw) return [];

  try {
    var parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(function (line) {
        return (
          line &&
          typeof line.sku === 'string' &&
          typeof line.size === 'string' &&
          Number.isInteger(line.qty) &&
          line.qty > 0
        );
      })
      .slice(0, LIMITS.maxLines)
      .map(function (line) {
        return {
          sku: line.sku,
          size: line.size,
          qty: Math.min(line.qty, LIMITS.maxQtyPerLine)
        };
      });
  } catch (error) {
    return [];
  }
}

function write() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch (error) {
    /* Storage unavailable — the in-memory cart still works for this page. */
  }

  listeners.forEach(function (listener) {
    listener(getLines());
  });
}

// Another tab changed the cart: adopt its version and re-render.
window.addEventListener('storage', function (event) {
  if (event.key !== STORAGE_KEY) return;

  lines = read();

  listeners.forEach(function (listener) {
    listener(getLines());
  });
});

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

function indexOf(sku, size) {
  return lines.findIndex(function (line) {
    return line.sku === sku && line.size === size;
  });
}

/** A defensive copy — callers must go through the mutators below. */
export function getLines() {
  return lines.map(function (line) {
    return { sku: line.sku, size: line.size, qty: line.qty };
  });
}

/** Total units in the bag, for the nav badge. */
export function count() {
  return lines.reduce(function (sum, line) {
    return sum + line.qty;
  }, 0);
}

export function qtyOf(sku, size) {
  var position = indexOf(sku, size);
  return position === -1 ? 0 : lines[position].qty;
}

export function isEmpty() {
  return lines.length === 0;
}

/**
 * Priced view of the cart for display. Lines whose product or size has
 * left the catalogue are dropped rather than throwing, so a stale cart
 * still renders.
 *
 * @returns {{ lines, subtotalPaise, shippingPaise, totalPaise }}
 */
export function snapshot(catalog) {
  var usable = lines.filter(function (line) {
    var product = findProduct(catalog, line.sku);
    return Boolean(product && findSize(product, line.size));
  });

  if (usable.length !== lines.length) {
    lines = usable;
    write();
  }

  if (usable.length === 0) {
    return { lines: [], subtotalPaise: 0, shippingPaise: 0, totalPaise: 0 };
  }

  return totalFor(catalog, usable, false);
}

/* ------------------------------------------------------------------ *
 * Mutators — callers cap `qty` against live stock; the server is the
 * check that counts either way.
 * ------------------------------------------------------------------ */

export function add(sku, size, qty) {
  var amount = qty || 1;
  var position = indexOf(sku, size);

  if (position === -1) {
    if (lines.length >= LIMITS.maxLines) return;
    lines.push({ sku: sku, size: size, qty: Math.min(amount, LIMITS.maxQtyPerLine) });
  } else {
    lines[position].qty = Math.min(lines[position].qty + amount, LIMITS.maxQtyPerLine);
  }

  write();
}

export function setQty(sku, size, qty) {
  var position = indexOf(sku, size);

  if (position === -1) return;

  if (qty < 1) {
    lines.splice(position, 1);
  } else {
    lines[position].qty = Math.min(qty, LIMITS.maxQtyPerLine);
  }

  write();
}

export function remove(sku, size) {
  var position = indexOf(sku, size);

  if (position === -1) return;

  lines.splice(position, 1);
  write();
}

export function clear() {
  lines = [];
  write();
}

/* ------------------------------------------------------------------ *
 * Subscriptions
 * ------------------------------------------------------------------ */

/** Calls `listener` on every change. Returns an unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  listener(getLines());

  return function unsubscribe() {
    listeners.delete(listener);
  };
}
