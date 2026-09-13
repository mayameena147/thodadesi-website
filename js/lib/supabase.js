/**
 * Supabase client — created lazily, once, for the whole page.
 *
 * Two things are fetched before it can exist: the public config from
 * /api/public-config, and the library itself from a CDN. Both are deferred
 * until something actually needs auth, so a shopper who never signs in never
 * pays for either.
 *
 * The anon key this uses is public by design. Everything it can reach is
 * governed by the row-level security policies in supabase/002-auth.sql — that
 * file, not this one, is where the security lives.
 */

var CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
var CONFIG_CACHE_KEY = 'thodadesi.config.v1';

var pending = null;

function readCachedConfig() {
  try {
    var raw = window.sessionStorage.getItem(CONFIG_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function cacheConfig(config) {
  try {
    window.sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
  } catch (error) {
    /* Caching is an optimisation, not a requirement. */
  }
}

async function loadConfig() {
  var cached = readCachedConfig();

  if (cached && cached.supabaseUrl && cached.supabaseAnonKey) return cached;

  var response = await fetch('/api/public-config');

  if (!response.ok) {
    throw new Error('Sign-in is unavailable right now.');
  }

  var config = await response.json();

  cacheConfig(config);

  return config;
}

/**
 * @returns {Promise<object>} the shared SupabaseClient.
 */
export function getSupabase() {
  if (!pending) {
    pending = Promise.all([loadConfig(), import(/* @vite-ignore */ CDN)])
      .then(function (results) {
        var config = results[0];
        var createClient = results[1].createClient;

        return createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            // The OAuth callback comes back with tokens in the URL; let the
            // library consume and clear them rather than parsing by hand.
            detectSessionInUrl: true,
            flowType: 'pkce'
          }
        });
      })
      .catch(function (error) {
        pending = null; // Allow a retry on the next attempt.
        throw error;
      });
  }

  return pending;
}
