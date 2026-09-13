/**
 * Mobile menu — built on demand, removed on close.
 */

var LINKS = [
  { href: 'index.html#drop', label: 'The drop' },
  { href: 'index.html#about', label: 'Our scene' },
  { href: 'index.html#club', label: 'Desi club' }
];

export function mountMobileMenu(navShell, menuButton) {
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
    menu.innerHTML = LINKS.map(function (link) {
      return '<a href="' + link.href + '">' + link.label + '</a>';
    }).join('');

    Array.prototype.forEach.call(menu.querySelectorAll('a'), function (link) {
      link.addEventListener('click', close);
    });

    navShell.after(menu);
    menuButton.setAttribute('aria-expanded', 'true');
  }

  menuButton.addEventListener('click', function () {
    if (menu) close();
    else open();
  });
}
