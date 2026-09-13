/**
 * Pricing tests — the module that decides what every order costs, and
 * whether the shelf can cover it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  priceLines, totalFor, availableStock, LIMITS, PricingError, OutOfStockError
} from '../js/lib/pricing.js';

function makeCatalog() {
  return {
    currency: 'INR',
    freeShippingThresholdPaise: 299900,
    shippingFlatPaise: 9900,
    codEnabled: true,
    products: [
      {
        sku: 'TD-KUR-001',
        name: 'Gulabo After Dark',
        pricePaise: 249000,
        sizes: [
          { size: 'S', variantId: 'v-s', pricePaise: null, stock: 3 },
          { size: 'M', variantId: 'v-m', pricePaise: null, stock: 0 },
          { size: 'L', variantId: 'v-l', pricePaise: 259000, stock: 5 }
        ]
      },
      {
        sku: 'TD-SAL-002',
        name: 'Mehfil, But Make It Chill',
        pricePaise: 429000,
        sizes: [
          { size: 'S', variantId: null, pricePaise: null, stock: null } // unknown
        ]
      }
    ]
  };
}

test('prices a line from the catalogue, ignoring anything the client sent', function () {
  var priced = priceLines(makeCatalog(), [
    { sku: 'TD-KUR-001', size: 'S', qty: 2, unitPricePaise: 1 } // 1 paise "sent"
  ]);

  assert.equal(priced[0].unitPricePaise, 249000);
  assert.equal(priced[0].linePricePaise, 498000);
  assert.equal(priced[0].variantId, 'v-s');
});

test('a size-level price override wins over the product price', function () {
  var priced = priceLines(makeCatalog(), [{ sku: 'TD-KUR-001', size: 'L', qty: 1 }]);

  assert.equal(priced[0].unitPricePaise, 259000);
});

test('charges flat shipping below the free threshold', function () {
  var view = totalFor(makeCatalog(), [{ sku: 'TD-KUR-001', size: 'S', qty: 1 }]);

  assert.equal(view.subtotalPaise, 249000);
  assert.equal(view.shippingPaise, 9900);
  assert.equal(view.totalPaise, 258900);
});

test('drops shipping at the free threshold', function () {
  var view = totalFor(makeCatalog(), [{ sku: 'TD-KUR-001', size: 'S', qty: 2 }]);

  assert.equal(view.shippingPaise, 0);
  assert.equal(view.totalPaise, 498000);
});

test('rejects an unknown product and an unknown size', function () {
  assert.throws(function () {
    priceLines(makeCatalog(), [{ sku: 'NOPE', size: 'S', qty: 1 }]);
  }, PricingError);

  assert.throws(function () {
    priceLines(makeCatalog(), [{ sku: 'TD-KUR-001', size: 'XXXL', qty: 1 }]);
  }, PricingError);
});

test('rejects zero, negative, fractional and oversized quantities', function () {
  [0, -1, 1.5, LIMITS.maxQtyPerLine + 1, 'two'].forEach(function (qty) {
    assert.throws(function () {
      priceLines(makeCatalog(), [{ sku: 'TD-KUR-001', size: 'S', qty: qty }]);
    }, PricingError);
  });
});

test('rejects duplicate sku+size lines', function () {
  assert.throws(function () {
    priceLines(makeCatalog(), [
      { sku: 'TD-KUR-001', size: 'S', qty: 1 },
      { sku: 'TD-KUR-001', size: 'S', qty: 1 }
    ]);
  }, PricingError);
});

test('with stock checking on, an out-of-stock size throws OutOfStockError', function () {
  assert.throws(function () {
    priceLines(makeCatalog(), [{ sku: 'TD-KUR-001', size: 'M', qty: 1 }], true);
  }, OutOfStockError);
});

test('with stock checking on, wanting more than the shelf holds throws', function () {
  assert.throws(function () {
    priceLines(makeCatalog(), [{ sku: 'TD-KUR-001', size: 'S', qty: 4 }], true);
  }, OutOfStockError);
});

test('with stock checking on, exactly the shelf quantity passes', function () {
  var priced = priceLines(makeCatalog(), [{ sku: 'TD-KUR-001', size: 'S', qty: 3 }], true);

  assert.equal(priced[0].qty, 3);
});

test('unknown stock (fallback catalogue) never blocks in the browser', function () {
  var priced = priceLines(makeCatalog(), [{ sku: 'TD-SAL-002', size: 'S', qty: 5 }], true);

  assert.equal(priced[0].qty, 5); // the server re-checks with real numbers
});

test('with stock checking off, stock levels are ignored', function () {
  var priced = priceLines(makeCatalog(), [{ sku: 'TD-KUR-001', size: 'M', qty: 1 }]);

  assert.equal(priced[0].linePricePaise, 249000);
});

test('availableStock reads the shelf, Infinity when unknown, 0 when missing', function () {
  var catalog = makeCatalog();

  assert.equal(availableStock(catalog, 'TD-KUR-001', 'S'), 3);
  assert.equal(availableStock(catalog, 'TD-KUR-001', 'M'), 0);
  assert.equal(availableStock(catalog, 'TD-SAL-002', 'S'), Infinity);
  assert.equal(availableStock(catalog, 'TD-KUR-001', 'XXXL'), 0);
  assert.equal(availableStock(catalog, 'NOPE', 'S'), 0);
});

test('caps total lines and total units', function () {
  var catalog = makeCatalog();

  // Too many units across lines: 10 + 10 + ... over maxUnits (40)
  var lines = [
    { sku: 'TD-KUR-001', size: 'S', qty: 10 },
    { sku: 'TD-KUR-001', size: 'M', qty: 10 },
    { sku: 'TD-KUR-001', size: 'L', qty: 10 },
    { sku: 'TD-SAL-002', size: 'S', qty: 10 }
  ];

  assert.equal(totalFor(catalog, lines).lines.length, 4); // 40 units: allowed

  lines = lines.concat([{ sku: 'TD-SAL-002', size: 'S', qty: 1 }]);

  assert.throws(function () {
    totalFor(catalog, lines); // duplicate line trips first — also fine
  }, PricingError);
});
