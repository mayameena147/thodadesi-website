/**
 * Thoda Desi — page interactions
 *
 *   1. Bag      — toggle products in and out, keep the nav badge in sync
 *   2. Menu     — open/close the mobile navigation
 *   3. Newsletter — swap the form for a confirmation message on submit
 *
 * No dependencies. Everything is scoped inside an IIFE so nothing leaks
 * onto `window`.
 */
(function () {
  'use strict';

  /** Icon reused when a bag button's label is rewritten. */
  var ARROW_UP_RIGHT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
    ' stroke-linejoin="round" class="lucide lucide-arrow-up-right" aria-hidden="true">' +
    '<path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>';


  /* ------------------------------------------------------------------ *
   * 1. Bag
   * ------------------------------------------------------------------ */

  /**
   * Wires up the "Add to bag" buttons. Each button toggles its own product,
   * and the nav badge shows how many products are currently in the bag.
   */
  function initBag() {
    var bagButton = document.querySelector('.bag-button');
    var badge = bagButton.querySelector('span');
    var buttons = document.querySelectorAll('.product-buy-row button');
    var bag = [];

    function render() {
      badge.textContent = String(bag.length);
      bagButton.setAttribute('aria-label', bag.length + ' items in bag');
    }

    function toggle(button, index) {
      var position = bag.indexOf(index);
      var isInBag = position !== -1;

      if (isInBag) {
        bag.splice(position, 1);
      } else {
        bag.push(index);
      }

      button.className = isInBag ? '' : 'added';
      button.innerHTML = (isInBag ? 'Add to bag' : 'In the bag') + ARROW_UP_RIGHT;
      render();
    }

    Array.prototype.forEach.call(buttons, function (button, index) {
      button.addEventListener('click', function () {
        toggle(button, index);
      });
    });

    render();
  }


  /* ------------------------------------------------------------------ *
   * 2. Mobile menu
   * ------------------------------------------------------------------ */

  /**
   * The menu is created on demand and inserted directly after the nav,
   * then removed again on close or when a link is followed.
   */
  function initMobileMenu() {
    var navShell = document.querySelector('.nav-shell');
    var menuButton = document.querySelector('.menu-button');
    var menu = null;

    function close() {
      if (!menu) return;

      menu.remove();
      menu = null;
      menuButton.setAttribute('aria-expanded', 'false');
    }

    function open() {
      menu = document.createElement('div');
      menu.className = 'mobile-menu';
      menu.innerHTML =
        '<a href="#drop">The drop</a>' +
        '<a href="#about">Our scene</a>' +
        '<a href="#club">Desi club</a>';

      Array.prototype.forEach.call(menu.querySelectorAll('a'), function (link) {
        link.addEventListener('click', close);
      });

      navShell.after(menu);
      menuButton.setAttribute('aria-expanded', 'true');
    }

    menuButton.addEventListener('click', function () {
      if (menu) {
        close();
      } else {
        open();
      }
    });
  }


  /* ------------------------------------------------------------------ *
   * 3. Newsletter
   * ------------------------------------------------------------------ */

  /**
   * Signup is presentational for now — the form is replaced by a
   * confirmation message instead of being posted anywhere.
   */
  function initNewsletter() {
    var form = document.querySelector('.signup-form');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      form.innerHTML =
        '<p class="success-message">You&rsquo;re in. Front-row energy unlocked &#10022;</p>';
    });
  }


  initBag();
  initMobileMenu();
  initNewsletter();
})();
