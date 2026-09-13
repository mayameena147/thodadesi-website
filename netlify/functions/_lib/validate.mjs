/**
 * Validation — the customer/address half of an order.
 *
 * Mirrors the HTML form's constraints. The form is a convenience; this is the
 * check that counts, because a request can arrive without ever touching it.
 */

import { badRequest } from './http.mjs';

var PHONE = /^[6-9]\d{9}$/;          // Indian mobile, without country code
var PINCODE = /^[1-9]\d{5}$/;        // Indian PIN, never starts with 0
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(value, field, min, max) {
  var trimmed = typeof value === 'string' ? value.trim() : '';

  if (trimmed.length < min || trimmed.length > max) {
    throw badRequest('Please check the ' + field + ' field.');
  }

  return trimmed;
}

/**
 * @returns a clean customer object; throws PublicError on anything invalid.
 */
export function validateCustomer(raw) {
  var input = raw || {};

  var phone = String(input.phone || '').replace(/[\s-]/g, '').replace(/^(\+91|91|0)/, '');
  var email = String(input.email || '').trim().toLowerCase();
  var pincode = String(input.pincode || '').trim();

  if (!PHONE.test(phone)) {
    throw badRequest('Enter a valid 10-digit Indian mobile number.');
  }

  // Email is optional; when given it must at least look like one.
  if (email && (!EMAIL.test(email) || email.length > 254)) {
    throw badRequest('Enter a valid email address.');
  }

  if (!PINCODE.test(pincode)) {
    throw badRequest('Enter a valid 6-digit PIN code.');
  }

  return {
    fullName: text(input.fullName, 'name', 2, 80),
    email: email || null,
    phone: phone,
    addressLine1: text(input.addressLine1, 'address', 5, 120),
    addressLine2: typeof input.addressLine2 === 'string'
      ? input.addressLine2.trim().slice(0, 120)
      : '',
    city: text(input.city, 'city', 2, 60),
    state: text(input.state, 'state', 2, 60),
    pincode: pincode,
    country: 'IN'
  };
}

/** Strips the cart down to the only three fields the server trusts. */
export function validateItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest('Your bag is empty.');
  }

  return raw.map(function (item) {
    return {
      sku: String((item && item.sku) || ''),
      size: String((item && item.size) || ''),
      qty: Number((item && item.qty) || 0)
    };
  });
}
