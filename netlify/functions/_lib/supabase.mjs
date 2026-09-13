/**
 * Supabase REST helper — every database call the functions make goes
 * through here, using the service_role key.
 *
 * That key bypasses row-level security, so it lives only in Netlify's
 * environment and is never sent to the browser. The RLS policies in
 * supabase/schema.sql therefore only describe what a BROWSER may do.
 */

import { env } from './http.mjs';

function restUrl(path) {
  return env('SUPABASE_URL').replace(/\/+$/, '') + '/rest/v1/' + path;
}

function headers(extra) {
  var key = env('SUPABASE_SERVICE_ROLE_KEY');

  return Object.assign(
    {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    extra || {}
  );
}

/**
 * @param {string} method  GET/POST/PATCH/DELETE
 * @param {string} path    PostgREST path incl. query string
 * @param {object} [body]
 * @param {string} [prefer] Prefer header (e.g. 'return=representation')
 */
export async function db(method, path, body, prefer) {
  var response = await fetch(restUrl(path), {
    method: method,
    headers: headers(prefer ? { Prefer: prefer } : undefined),
    body: body ? JSON.stringify(body) : undefined
  });

  var text = await response.text();

  if (!response.ok) {
    console.error('[supabase]', method, path.split('?')[0], response.status, text);
    var error = new Error('Supabase ' + method + ' failed with ' + response.status);
    error.supabaseStatus = response.status;
    error.supabaseBody = text;
    throw error;
  }

  return text ? JSON.parse(text) : null;
}

/** Calls a Postgres function (RPC). Throws with .supabaseBody on SQL errors. */
export function rpc(name, args) {
  return db('POST', 'rpc/' + name, args || {});
}
