/**
 * Catalogue — the browser's copy of what is for sale.
 *
 * Loads /api/catalog (live prices and per-size stock from Supabase). If the
 * API is unreachable — functions not deployed yet, or a blip — it falls
 * back to the static data/catalog.json, whose stock is "unknown" (null):
 * the shop keeps rendering and the server still refuses anything that is
 * actually out of stock at purchase time.
 *
 * Fetched once per page and cached as a promise.
 */

var pending = null;

function fetchJson(url) {
  return fetch(url).then(function (response) {
    if (!response.ok) {
      throw new Error('Could not load the catalogue (' + response.status + ').');
    }
    return response.json();
  });
}

export function loadCatalog() {
  if (!pending) {
    pending = fetchJson('/api/catalog')
      .catch(function () {
        return fetchJson(new URL('../../data/catalog.json', import.meta.url));
      })
      .catch(function (error) {
        pending = null;
        throw error;
      });
  }

  return pending;
}
