/**
 * Pricing — the single source of truth for what an order costs.
 *
 * Imported by BOTH the browser (to preview a total) and the Netlify
 * functions (to charge one). The browser's number is a preview; the
 * server's number is the one that reaches Razorpay. They agree because it
 * is the same code — but the server prices against the DATABASE catalogue,
 * so nothing the browser sends can change a price.
 *
 * Catalogue shape (built from Supabase by the server, mirrored by
 * data/catalog.json as an offline fallback):
 *
 *   {
 *     currency, freeShippingThresholdPaise, shippingFlatPaise, codEnabled,
 *     products: [{ sku, name, pricePaise, ...,
 *       sizes: [{ size, variantId, pricePaise|null, stock|null }] }]
 *   }
 *
 * stock === null means "unknown" (static fallback); the server always knows.
 * Everything is integers in paise. Never floats for money.
 */

/** Hard limits, enforced server-side. Keeps a hostile cart from being useful. */
export const LIMITS = Object.freeze({
  maxQtyPerLine: 10,
  maxLines: 20,
  maxUnits: 40
});

class PricingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PricingError';
  }
}

class OutOfStockError extends PricingError {
  constructor(message, shortages) {
    super(message);
    this.name = 'OutOfStockError';
    this.shortages = shortages || [];
  }
}

export { PricingError, OutOfStockError };

export function findProduct(catalog, sku) {
  return catalog.products.find(function (product) {
    return product.sku === sku;
  });
}

export function findSize(product, size) {
  return product.sizes.find(function (entry) {
    return entry.size === size;
  });
}

/**
 * Validates raw cart lines against the catalogue and returns priced lines.
 * Throws PricingError on anything the catalogue does not recognise.
 *
 * @param {object}  catalog     the catalogue described above
 * @param {Array}   lines       untrusted [{ sku, size, qty }]
 * @param {boolean} checkStock  also fail on insufficient stock (server: true)
 * @returns {Array} [{ sku, variantId, name, size, qty, unitPricePaise, linePricePaise }]
 */
export function priceLines(catalog, lines, checkStock) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new PricingError('Cart is empty.');
  }

  if (lines.length > LIMITS.maxLines) {
    throw new PricingError('Too many items in the cart.');
  }

  var seen = new Set();
  var units = 0;
  var shortages = [];

  var priced = lines.map(function (line) {
    var product = findProduct(catalog, line && line.sku);

    if (!product) {
      throw new PricingError('Unknown product: ' + String(line && line.sku));
    }

    var sizeEntry = findSize(product, line.size);

    if (!sizeEntry) {
      throw new PricingError('Unknown size for ' + product.sku + ': ' + String(line.size));
    }

    var key = product.sku + '|' + line.size;

    if (seen.has(key)) {
      throw new PricingError('Duplicate cart line: ' + key);
    }

    seen.add(key);

    var qty = Number(line.qty);

    if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.maxQtyPerLine) {
      throw new PricingError('Invalid quantity for ' + product.sku + '.');
    }

    if (checkStock && typeof sizeEntry.stock === 'number' && sizeEntry.stock < qty) {
      shortages.push({
        sku: product.sku,
        name: product.name,
        size: line.size,
        wanted: qty,
        available: Math.max(sizeEntry.stock, 0)
      });
    }

    units += qty;

    var unit = sizeEntry.pricePaise || product.pricePaise;

    return {
      sku: product.sku,
      variantId: sizeEntry.variantId || null,
      name: product.name,
      size: line.size,
      qty: qty,
      unitPricePaise: unit,
      linePricePaise: unit * qty
    };
  });

  if (units > LIMITS.maxUnits) {
    throw new PricingError('Too many units in the cart.');
  }

  if (shortages.length > 0) {
    var first = shortages[0];
    throw new OutOfStockError(
      first.available === 0
        ? first.name + ' (size ' + first.size + ') is out of stock.'
        : 'Only ' + first.available + ' left of ' + first.name +
          ' (size ' + first.size + ').',
      shortages
    );
  }

  return priced;
}

/**
 * Totals a set of priced lines. Shipping is free above the configured
 * threshold; both numbers come from the catalogue (i.e. from shop_config).
 *
 * @returns {{ lines, subtotalPaise, shippingPaise, totalPaise }}
 */
export function totalFor(catalog, lines, checkStock) {
  var priced = priceLines(catalog, lines, checkStock);

  var subtotalPaise = priced.reduce(function (sum, line) {
    return sum + line.linePricePaise;
  }, 0);

  var shippingPaise =
    subtotalPaise >= catalog.freeShippingThresholdPaise ? 0 : catalog.shippingFlatPaise;

  return {
    lines: priced,
    subtotalPaise: subtotalPaise,
    shippingPaise: shippingPaise,
    totalPaise: subtotalPaise + shippingPaise
  };
}

/** How many units of sku+size the catalogue says can still be bought.
 *  Infinity when stock is unknown (static fallback catalogue). */
export function availableStock(catalog, sku, size) {
  var product = findProduct(catalog, sku);
  if (!product) return 0;

  var entry = findSize(product, size);
  if (!entry) return 0;

  if (typeof entry.stock !== 'number') return Infinity;

  return Math.max(entry.stock, 0);
}
