/**
 * Icons — inline SVG (Lucide), so the page carries no icon font or sprite.
 */

function icon(size, body, name) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"' +
    ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-' + name + '"' +
    ' aria-hidden="true">' + body + '</svg>'
  );
}

export var arrowUpRight = icon(17, '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', 'arrow-up-right');

export var close = icon(20, '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 'x');

export var minus = icon(15, '<path d="M5 12h14"/>', 'minus');

export var plus = icon(15, '<path d="M5 12h14"/><path d="M12 5v14"/>', 'plus');

export var trash = icon(
  15,
  '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
    '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'trash-2'
);

export var heart = icon(
  19,
  '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
  'heart'
);

export var lock = icon(
  15,
  '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'lock'
);
