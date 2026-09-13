/**
 * GET /api/catalog
 *
 * The live catalogue: products, per-size stock and prices from Supabase,
 * plus the shipping rules from shop_config. This is what the storefront
 * renders from — data/catalog.json is only a fallback for when this
 * endpoint cannot be reached.
 *
 * Cached briefly at the CDN so a busy drop does not hammer the database;
 * 30 seconds of staleness is invisible to shoppers because every order is
 * re-checked against the database at purchase time anyway.
 */

import { handle } from './_lib/http.mjs';
import { loadCatalogFromDb } from './_lib/catalog.mjs';

export default handle('catalog', async function () {
  var catalog = await loadCatalogFromDb();

  return new Response(JSON.stringify(catalog), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=30'
    }
  });
});
