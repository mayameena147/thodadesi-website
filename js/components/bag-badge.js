/**
 * Bag badge — keeps the nav count in sync with the cart on every page.
 */

import * as cart from '../lib/cart.js';

export function mountBagBadge(button, onClick) {
  var badge = button.querySelector('span');

  cart.subscribe(function () {
    var total = cart.count();

    badge.textContent = String(total);
    badge.classList.toggle('has-items', total > 0);
    button.setAttribute('aria-label', total + (total === 1 ? ' item' : ' items') + ' in bag');
  });

  if (onClick) button.addEventListener('click', onClick);
}
