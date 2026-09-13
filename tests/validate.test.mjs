/**
 * Address validation tests — the server-side copy of the form's rules.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateCustomer, validateItems } from '../netlify/functions/_lib/validate.mjs';

var VALID = {
  fullName: 'Aarohi Sharma',
  email: 'Aarohi@Example.COM',
  phone: '+91 98765 43210',
  addressLine1: '12 Hauz Khas Village',
  city: 'New Delhi',
  state: 'Delhi',
  pincode: '110016'
};

test('normalises a valid customer', function () {
  var customer = validateCustomer(VALID);

  assert.equal(customer.phone, '9876543210'); // +91 and spaces stripped
  assert.equal(customer.email, 'aarohi@example.com');
  assert.equal(customer.addressLine2, '');
  assert.equal(customer.country, 'IN');
});

test('rejects landline and short mobile numbers', function () {
  ['1123456789', '98765', '0987654321'].forEach(function (phone) {
    assert.throws(function () {
      validateCustomer(Object.assign({}, VALID, { phone: phone }));
    }, /mobile/i, phone + ' should be rejected');
  });
});

test('rejects a PIN code starting with zero', function () {
  assert.throws(function () {
    validateCustomer(Object.assign({}, VALID, { pincode: '011001' }));
  }, /PIN/i);
});

test('rejects a malformed email', function () {
  assert.throws(function () {
    validateCustomer(Object.assign({}, VALID, { email: 'not-an-email' }));
  }, /email/i);
});

test('rejects a missing address', function () {
  assert.throws(function () {
    validateCustomer(Object.assign({}, VALID, { addressLine1: '' }));
  }, /address/i);
});

test('strips cart lines down to sku, size and qty', function () {
  var items = validateItems([
    { sku: 'TD-KUR-001', size: 'M', qty: 1, pricePaise: 1, isFree: true }
  ]);

  assert.deepEqual(items, [{ sku: 'TD-KUR-001', size: 'M', qty: 1 }]);
});

test('email is optional — missing email becomes null', function () {
  var input = Object.assign({}, VALID);
  delete input.email;

  var customer = validateCustomer(input);

  assert.equal(customer.email, null);
});

test('a malformed email is still rejected when given', function () {
  var input = Object.assign({}, VALID, { email: 'not-an-email' });

  assert.throws(function () {
    validateCustomer(input);
  });
});
