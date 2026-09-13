/**
 * GET /api/public-config
 *
 * Hands the browser the two values it needs to talk to Supabase Auth
 * (admin sign-in). Both are public by design — the anon key is meant to
 * ship to browsers, and everything it can reach is governed by row-level
 * security (supabase/schema.sql).
 *
 * The service_role key is never read in this file.
 */

import { json, env, handle } from './_lib/http.mjs';

export default handle('public-config', async function () {
  return json(200, {
    supabaseUrl: env('SUPABASE_URL'),
    supabaseAnonKey: env('SUPABASE_ANON_KEY')
  });
});
