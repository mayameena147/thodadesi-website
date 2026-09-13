/**
 * DOM — the two helpers every component here needs.
 */

/**
 * Escapes a value for interpolation into an HTML string. Product copy comes
 * from our own catalog, but cart lines round-trip through localStorage, so
 * nothing reaches innerHTML unescaped.
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** querySelector that fails loudly instead of returning null. */
export function need(selector, root) {
  var element = (root || document).querySelector(selector);

  if (!element) {
    throw new Error('Expected an element matching ' + selector);
  }

  return element;
}
