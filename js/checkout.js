/**
 * Checkout page entry point.
 *
 * The browser never decides what anything costs. It sends { sku, size,
 * qty } to the server, the server re-prices the cart against the database
 * and (for prepaid) creates the Razorpay order; the amount comes back from
 * the server. The total shown here is a preview computed from the same
 * pricing module.
 *
 * Two ways to pay:
 *   prepaid -> /api/create-order  -> Razorpay Checkout -> /api/verify-payment
 *   cod     -> /api/create-cod-order
 */

import { need, escapeHtml } from './lib/dom.js';
import { loadCatalog } from './lib/catalog.js';
import { formatPaise } from './lib/money.js';
import { loadRazorpay } from './lib/razorpay.js';
import { STATES } from './lib/states.js';
import * as icons from './lib/icons.js';
import * as cart from './lib/cart.js';
import { mountBagBadge } from './components/bag-badge.js';
import { mountMobileMenu } from './components/mobile-menu.js';

var BRAND = {
  name: 'Thoda Desi',
  description: 'Drop 001 / Thoda Extra',
  image: window.location.origin + '/images/logo.jpg',
  themeColor: '#dc3d24'
};

var form = need('.checkout-form');
var summary = need('.checkout-summary');
var payButton = need('.pay-button');
var statusBox = need('.checkout-status');
var stateSelect = need('#state');
var methodInputs = form.querySelectorAll('input[name="paymentMethod"]');

mountMobileMenu(need('.nav-shell'), need('.menu-button'));
mountBagBadge(need('.bag-button'));

stateSelect.insertAdjacentHTML(
  'beforeend',
  STATES.map(function (state) {
    return '<option value="' + escapeHtml(state) + '">' + escapeHtml(state) + '</option>';
  }).join('')
);

/* ------------------------------------------------------------------ *
 * Status messages
 * ------------------------------------------------------------------ */

function setStatus(kind, message) {
  statusBox.className = 'checkout-status ' + kind;
  statusBox.textContent = message;
  statusBox.hidden = !message;
}

function clearStatus() {
  setStatus('', '');
}

/* ------------------------------------------------------------------ *
 * Payment method + button label
 * ------------------------------------------------------------------ */

function chosenMethod() {
  for (var i = 0; i < methodInputs.length; i++) {
    if (methodInputs[i].checked) return methodInputs[i].value;
  }

  return 'prepaid';
}

function buttonLabel(totalPaise) {
  return chosenMethod() === 'cod'
    ? 'Place COD order' + icons.arrowUpRight
    : 'Pay ' + formatPaise(totalPaise) + icons.arrowUpRight;
}

/* ------------------------------------------------------------------ *
 * Order summary
 * ------------------------------------------------------------------ */

function renderSummary(catalog) {
  var view = cart.snapshot(catalog);

  if (view.lines.length === 0) {
    summary.innerHTML =
      '<div class="summary-empty">' +
        '<h2>Your bag is empty</h2>' +
        '<p>Add a piece from the drop and come back.</p>' +
        '<a class="primary-cta" href="index.html#drop">Shop the drop' +
          icons.arrowUpRight + '</a>' +
      '</div>';

    form.hidden = true;
    return view;
  }

  form.hidden = false;

  var shipping = view.shippingPaise === 0 ? 'Free' : formatPaise(view.shippingPaise);

  summary.innerHTML =
    '<h2>Order summary</h2>' +
    '<ul class="summary-lines">' +
      view.lines
        .map(function (line) {
          return (
            '<li>' +
              '<span class="summary-name">' + escapeHtml(line.name) +
                '<small>Size ' + escapeHtml(line.size) + ' &times; ' + line.qty + '</small>' +
              '</span>' +
              '<span>' + formatPaise(line.linePricePaise) + '</span>' +
            '</li>'
          );
        })
        .join('') +
    '</ul>' +
    '<dl class="summary-totals">' +
      '<div><dt>Subtotal</dt><dd>' + formatPaise(view.subtotalPaise) + '</dd></div>' +
      '<div><dt>Shipping</dt><dd>' + shipping + '</dd></div>' +
      '<div class="summary-grand"><dt>Total</dt><dd>' +
        formatPaise(view.totalPaise) + '</dd></div>' +
    '</dl>' +
    '<p class="summary-edit"><a href="index.html#drop">&larr; Keep shopping</a></p>';

  payButton.innerHTML = buttonLabel(view.totalPaise);

  return view;
}

/* ------------------------------------------------------------------ *
 * Form
 * ------------------------------------------------------------------ */

/** Reads the address form into the shape the order APIs expect. */
function readCustomer() {
  var data = new FormData(form);
  var value = function (key) {
    return String(data.get(key) || '').trim();
  };

  return {
    fullName: value('fullName'),
    email: value('email'),
    phone: value('phone'),
    addressLine1: value('addressLine1'),
    addressLine2: value('addressLine2'),
    city: value('city'),
    state: value('state'),
    pincode: value('pincode')
  };
}

function setBusy(busy, label) {
  payButton.disabled = busy;
  payButton.classList.toggle('busy', busy);

  if (label) payButton.innerHTML = label;
}

/* ------------------------------------------------------------------ *
 * Talking to the functions
 * ------------------------------------------------------------------ */

async function postJson(url, payload) {
  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  var body = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    throw new Error(body.error || 'Something went wrong. Please try again.');
  }

  return body;
}

/** What thank-you.html renders. Session-scoped: gone once the tab closes. */
function rememberConfirmation(orderNumber, method, view) {
  try {
    window.sessionStorage.setItem('thodadesi.lastOrder', JSON.stringify({
      orderNumber: orderNumber,
      paymentMethod: method,
      lines: view.lines.map(function (line) {
        return { name: line.name, size: line.size, qty: line.qty,
                 linePricePaise: line.linePricePaise };
      }),
      subtotalPaise: view.subtotalPaise,
      shippingPaise: view.shippingPaise,
      totalPaise: view.totalPaise
    }));
  } catch (error) {
    /* Confirmation still shows the order number from the URL. */
  }
}

function goToThankYou(orderNumber) {
  window.location.href = 'thank-you.html?order=' + encodeURIComponent(orderNumber);
}

/* ------------------------------------------------------------------ *
 * COD
 * ------------------------------------------------------------------ */

async function placeCodOrder(catalog, view, customer) {
  setBusy(true, 'Placing your order&hellip;');

  try {
    var order = await postJson('/api/create-cod-order', {
      items: cart.getLines(),
      customer: customer
    });

    rememberConfirmation(order.orderNumber, 'cod', view);
    cart.clear();
    goToThankYou(order.orderNumber);
  } catch (error) {
    setBusy(false, buttonLabel(view.totalPaise));
    setStatus('error', error.message);
  }
}

/* ------------------------------------------------------------------ *
 * Prepaid (Razorpay)
 * ------------------------------------------------------------------ */

async function payOnline(catalog, view, customer) {
  var totalLabel = buttonLabel(view.totalPaise);

  setBusy(true, 'Starting&hellip;');

  var Razorpay;
  var order;

  try {
    // Fetch the script and create the order together — neither needs the other.
    var results = await Promise.all([
      loadRazorpay(),
      postJson('/api/create-order', {
        items: cart.getLines(),
        customer: customer
      })
    ]);

    Razorpay = results[0];
    order = results[1];
  } catch (error) {
    setBusy(false, totalLabel);
    setStatus('error', error.message);
    return;
  }

  // The server's total wins. If it disagrees with ours, the catalogue moved
  // under us — show the server's number rather than charging a stale one.
  if (order.amountPaise !== view.totalPaise) {
    setStatus(
      'notice',
      'Prices have been updated. You will be charged ' +
        formatPaise(order.amountPaise) + '.'
    );
  }

  var checkout = new Razorpay({
    key: order.keyId,
    order_id: order.razorpayOrderId,
    amount: order.amountPaise,
    currency: order.currency,
    name: BRAND.name,
    description: BRAND.description,
    image: BRAND.image,
    theme: { color: BRAND.themeColor },
    prefill: {
      name: customer.fullName,
      email: customer.email,
      contact: customer.phone
    },
    notes: { orderNumber: order.orderNumber },
    modal: {
      ondismiss: function () {
        setBusy(false, totalLabel);
        setStatus('notice', 'Payment cancelled. Your bag is still here.');
      }
    },
    handler: async function (response) {
      setBusy(true, 'Confirming&hellip;');

      try {
        await postJson('/api/verify-payment', {
          orderNumber: order.orderNumber,
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature
        });

        rememberConfirmation(order.orderNumber, 'prepaid', view);
        cart.clear();
        goToThankYou(order.orderNumber);
      } catch (error) {
        // The money may well have left. Never tell the shopper it failed.
        setBusy(false, totalLabel);
        setStatus(
          'error',
          'Your payment went through but we could not confirm it here. ' +
            'Keep payment ID ' + response.razorpay_payment_id +
            ' and email hello@thodadesi.com — we will sort it out.'
        );
      }
    }
  });

  checkout.on('payment.failed', function (event) {
    var reason = (event && event.error && event.error.description) || 'The payment failed.';

    setBusy(false, totalLabel);
    setStatus('error', reason + ' No money has been taken. Please try again.');
  });

  checkout.open();
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

loadCatalog()
  .then(function (catalog) {
    renderSummary(catalog);
    cart.subscribe(function () {
      renderSummary(catalog);
    });

    // Hide the COD option entirely when it is switched off in shop_config.
    if (catalog.codEnabled === false) {
      var codOption = form.querySelector('.method-cod');
      if (codOption) codOption.hidden = true;
    }

    Array.prototype.forEach.call(methodInputs, function (input) {
      input.addEventListener('change', function () {
        var view = cart.snapshot(catalog);
        payButton.innerHTML = buttonLabel(view.totalPaise);
      });
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus();

      var view = cart.snapshot(catalog);

      if (view.lines.length === 0) {
        setStatus('error', 'Your bag is empty.');
        return;
      }

      var customer = readCustomer();

      if (chosenMethod() === 'cod') placeCodOrder(catalog, view, customer);
      else payOnline(catalog, view, customer);
    });
  })
  .catch(function (error) {
    console.error(error);
    summary.innerHTML = '<p class="grid-error">Checkout could not load. Please refresh.</p>';
    form.hidden = true;
  });
