/**
 * Home page entry point.
 *
 * The static cards in index.html are the no-JS fallback (and what search
 * engines see). Once the catalogue loads, the grid is re-rendered live —
 * same design, plus size pickers and real stock.
 */

import { need } from './lib/dom.js';
import { loadCatalog } from './lib/catalog.js';
import { mountProductGrid } from './components/product-grid.js';
import { mountCartDrawer } from './components/cart-drawer.js';
import { mountBagBadge } from './components/bag-badge.js';
import { mountMobileMenu } from './components/mobile-menu.js';
import { mountNewsletter } from './components/newsletter.js';

mountMobileMenu(need('.nav-shell'), need('.menu-button'));
mountNewsletter(need('.signup-form'));

loadCatalog()
  .then(function (catalog) {
    var drawer = mountCartDrawer(catalog);

    mountProductGrid(need('.product-grid'), catalog, drawer.open);
    mountBagBadge(need('.bag-button'), drawer.open);
  })
  .catch(function (error) {
    console.error(error);
    // The static cards are still on the page; shopping just isn't wired.
  });
