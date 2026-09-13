/**
 * Product grid — renders the drop from the catalogue.
 *
 * Every card carries a size picker. "Add to bag" stays disabled until a
 * size is chosen, because an apparel order without a size is an order we
 * cannot ship.
 *
 * Stock rules (when the live catalogue is loaded):
 *   - a size with zero stock renders struck-through and cannot be picked
 *   - a product with no stock in any size shows "Out of stock"
 *   - adding is capped at what is left, counting what is already in the bag
 */

import { escapeHtml } from '../lib/dom.js';
import { formatPaise } from '../lib/money.js';
import { availableStock } from '../lib/pricing.js';
import * as icons from '../lib/icons.js';
import * as cart from '../lib/cart.js';

function isSoldOut(product) {
  return product.sizes.every(function (entry) {
    return typeof entry.stock === 'number' && entry.stock <= 0;
  });
}

function cardMarkup(product, position) {
  var soldOut = isSoldOut(product);

  var sizeChips = product.sizes
    .map(function (entry) {
      var gone = typeof entry.stock === 'number' && entry.stock <= 0;
      var low = typeof entry.stock === 'number' && entry.stock > 0 && entry.stock <= 3;

      return (
        '<button type="button" class="size-chip' + (gone ? ' gone' : '') + '"' +
        ' role="radio" aria-checked="false" data-size="' + escapeHtml(entry.size) + '"' +
        (gone ? ' disabled aria-label="' + escapeHtml(entry.size) + ' — out of stock"' : '') +
        (low ? ' data-low="Only ' + entry.stock + ' left"' : '') +
        '>' + escapeHtml(entry.size) + '</button>'
      );
    })
    .join('');

  var buyButton = soldOut
    ? '<button type="button" class="add-button" disabled>Out of stock</button>'
    : '<button type="button" class="add-button" disabled>Pick a size' +
      icons.arrowUpRight + '</button>';

  return (
    '<article class="product-card product-card-' + (position + 1) + '"' +
    ' data-sku="' + escapeHtml(product.sku) + '">' +
      '<div class="product-image">' +
        '<img src="' + escapeHtml(product.image) + '" alt="' + escapeHtml(product.alt) + '"' +
        ' loading="lazy" decoding="async">' +
        '<button class="heart-button" type="button"' +
        ' aria-label="Save ' + escapeHtml(product.name) + '">' + icons.heart + '</button>' +
        '<span class="product-color">' + escapeHtml(product.colour) + '</span>' +
        (soldOut ? '<span class="soldout-flag">Sold out</span>' : '') +
      '</div>' +

      '<div class="product-info">' +
        '<p>' + escapeHtml(product.number) + ' / ' + escapeHtml(product.category) + '</p>' +
        '<h3>' + escapeHtml(product.name) + '</h3>' +
        '<p class="product-description">' + escapeHtml(product.description) + '</p>' +

        '<div class="size-row" role="radiogroup"' +
        ' aria-label="Size for ' + escapeHtml(product.name) + '">' +
          '<span class="size-label">Size</span>' +
          '<div class="size-chips">' + sizeChips + '</div>' +
        '</div>' +

        '<div class="product-buy-row">' +
          '<strong>' + formatPaise(product.pricePaise) + '</strong>' +
          buyButton +
        '</div>' +
      '</div>' +
    '</article>'
  );
}

/**
 * @param {HTMLElement} root     the .product-grid container
 * @param {object}      catalog  parsed catalogue
 * @param {Function}    onAdd    called after a successful add (opens the drawer)
 */
export function mountProductGrid(root, catalog, onAdd) {
  root.innerHTML = catalog.products.map(cardMarkup).join('');

  Array.prototype.forEach.call(root.querySelectorAll('.product-card'), function (card) {
    var addButton = card.querySelector('.add-button');
    var heartButton = card.querySelector('.heart-button');
    var chips = card.querySelectorAll('.size-chip');
    var sku = card.dataset.sku;
    var chosenSize = null;
    var resetTimer = null;

    function setLabel(text) {
      addButton.innerHTML = text + icons.arrowUpRight;
    }

    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener('click', function () {
        if (chip.disabled) return;

        chosenSize = chip.dataset.size;

        Array.prototype.forEach.call(chips, function (other) {
          var selected = other === chip;
          other.classList.toggle('selected', selected);
          other.setAttribute('aria-checked', selected ? 'true' : 'false');
        });

        addButton.disabled = false;
        window.clearTimeout(resetTimer);
        setLabel('Add to bag');
      });
    });

    addButton.addEventListener('click', function () {
      if (!chosenSize) return;

      // Cap against live stock, counting what is already in the bag.
      var available = availableStock(catalog, sku, chosenSize);
      var inBag = cart.qtyOf(sku, chosenSize);

      if (inBag + 1 > available) {
        addButton.classList.add('added');
        setLabel(available === 0 ? 'Out of stock' : 'No more left');

        window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(function () {
          addButton.classList.remove('added');
          setLabel('Add to bag');
        }, 1800);

        return;
      }

      cart.add(sku, chosenSize, 1);

      addButton.classList.add('added');
      setLabel('Added ' + escapeHtml(chosenSize));

      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(function () {
        addButton.classList.remove('added');
        setLabel('Add to bag');
      }, 1800);

      if (onAdd) onAdd();
    });

    // Save-for-later is presentational until there are accounts to save into.
    heartButton.addEventListener('click', function () {
      heartButton.classList.toggle('saved');
    });
  });
}
