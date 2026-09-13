/**
 * Cart drawer — the bag, as a slide-over panel.
 *
 * Owns its own markup so no page has to carry empty drawer scaffolding.
 * Re-renders on every cart change, including changes made in another tab.
 * The + stepper respects live stock when the catalogue knows it.
 */

import { escapeHtml } from '../lib/dom.js';
import { formatPaise } from '../lib/money.js';
import { availableStock } from '../lib/pricing.js';
import * as icons from '../lib/icons.js';
import * as cart from '../lib/cart.js';

function lineMarkup(line, product, canIncrease) {
  var key = escapeHtml(line.sku) + '|' + escapeHtml(line.size);

  return (
    '<li class="drawer-line" data-sku="' + escapeHtml(line.sku) + '"' +
    ' data-size="' + escapeHtml(line.size) + '">' +
      '<img src="' + escapeHtml(product.image) + '" alt="" loading="lazy">' +

      '<div class="drawer-line-body">' +
        '<h3>' + escapeHtml(line.name) + '</h3>' +
        '<p class="drawer-line-meta">Size ' + escapeHtml(line.size) + ' &middot; ' +
          formatPaise(line.unitPricePaise) + '</p>' +

        '<div class="qty-stepper" role="group" aria-label="Quantity for ' +
          escapeHtml(line.name) + ', size ' + escapeHtml(line.size) + '">' +
          '<button type="button" data-action="decrease"' +
          ' aria-label="Decrease quantity">' + icons.minus + '</button>' +
          '<output for="' + key + '">' + line.qty + '</output>' +
          '<button type="button" data-action="increase"' +
          (canIncrease ? '' : ' disabled') +
          ' aria-label="Increase quantity">' + icons.plus + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="drawer-line-end">' +
        '<strong>' + formatPaise(line.linePricePaise) + '</strong>' +
        '<button type="button" class="drawer-remove" data-action="remove"' +
        ' aria-label="Remove ' + escapeHtml(line.name) + ', size ' +
        escapeHtml(line.size) + '">' + icons.trash + '</button>' +
      '</div>' +
    '</li>'
  );
}

function bodyMarkup(catalog, view) {
  if (view.lines.length === 0) {
    return (
      '<div class="drawer-empty">' +
        '<p>Your bag is empty.</p>' +
        '<a class="primary-cta" href="index.html#drop" data-action="close">' +
          'Shop the drop' + icons.arrowUpRight +
        '</a>' +
      '</div>'
    );
  }

  var bySku = new Map(
    catalog.products.map(function (product) {
      return [product.sku, product];
    })
  );

  var shipping =
    view.shippingPaise === 0 ? 'Free' : formatPaise(view.shippingPaise);

  var away = catalog.freeShippingThresholdPaise - view.subtotalPaise;

  var nudge =
    away > 0
      ? '<p class="drawer-nudge">' + formatPaise(away) + ' away from free shipping.</p>'
      : '';

  return (
    '<ul class="drawer-lines">' +
      view.lines
        .map(function (line) {
          var canIncrease =
            line.qty < availableStock(catalog, line.sku, line.size);

          return lineMarkup(line, bySku.get(line.sku), canIncrease);
        })
        .join('') +
    '</ul>' +

    nudge +

    '<dl class="drawer-totals">' +
      '<div><dt>Subtotal</dt><dd>' + formatPaise(view.subtotalPaise) + '</dd></div>' +
      '<div><dt>Shipping</dt><dd>' + shipping + '</dd></div>' +
      '<div class="drawer-grand"><dt>Total</dt><dd>' +
        formatPaise(view.totalPaise) + '</dd></div>' +
    '</dl>' +

    '<a class="primary-cta drawer-checkout" href="checkout.html">' +
      'Checkout' + icons.arrowUpRight +
    '</a>' +

    '<p class="drawer-fineprint">' + icons.lock +
      ' Taxes included. Pay online or cash on delivery.</p>'
  );
}

/**
 * Creates the drawer and returns { open, close }.
 * @param {object} catalog parsed catalogue
 */
export function mountCartDrawer(catalog) {
  var overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.hidden = true;

  var panel = document.createElement('aside');
  panel.className = 'drawer-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Your bag');
  panel.hidden = true;

  panel.innerHTML =
    '<header class="drawer-head">' +
      '<h2>Your bag</h2>' +
      '<button type="button" class="icon-button drawer-close"' +
      ' aria-label="Close bag">' + icons.close + '</button>' +
    '</header>' +
    '<div class="drawer-body"></div>';

  document.body.append(overlay, panel);

  var body = panel.querySelector('.drawer-body');
  var lastFocused = null;

  function render() {
    body.innerHTML = bodyMarkup(catalog, cart.snapshot(catalog));
  }

  function open() {
    lastFocused = document.activeElement;
    overlay.hidden = false;
    panel.hidden = false;

    // Two frames so the browser paints the hidden state before transitioning.
    requestAnimationFrame(function () {
      overlay.classList.add('visible');
      panel.classList.add('visible');
    });

    document.body.classList.add('drawer-open');
    panel.querySelector('.drawer-close').focus();
  }

  function close() {
    overlay.classList.remove('visible');
    panel.classList.remove('visible');
    document.body.classList.remove('drawer-open');

    window.setTimeout(function () {
      overlay.hidden = true;
      panel.hidden = true;
    }, 240);

    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  overlay.addEventListener('click', close);
  panel.querySelector('.drawer-close').addEventListener('click', close);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) close();
  });

  // One delegated handler for every control inside a line.
  body.addEventListener('click', function (event) {
    var control = event.target.closest('[data-action]');

    if (!control) return;

    if (control.dataset.action === 'close') {
      close();
      return;
    }

    var line = control.closest('.drawer-line');

    if (!line) return;

    var sku = line.dataset.sku;
    var size = line.dataset.size;
    var current = cart.getLines().find(function (entry) {
      return entry.sku === sku && entry.size === size;
    });

    if (!current) return;

    if (control.dataset.action === 'increase') {
      if (current.qty < availableStock(catalog, sku, size)) {
        cart.setQty(sku, size, current.qty + 1);
      }
    }
    if (control.dataset.action === 'decrease') cart.setQty(sku, size, current.qty - 1);
    if (control.dataset.action === 'remove') cart.remove(sku, size);
  });

  cart.subscribe(render);

  return { open: open, close: close };
}
