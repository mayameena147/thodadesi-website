/**
 * Auth — who is calling the admin endpoints, and are they allowed to?
 *
 * The rule this file enforces: a role claim from the browser is worth
 * nothing. js/admin.js only decides what to draw. Every privileged action
 * re-resolves the caller's role HERE, from the user_roles table, using the
 * service_role key — a table no browser request can read or forge.
 *
 * Tokens are verified by asking Supabase (GET /auth/v1/user) rather than by
 * checking a signature locally: it costs one request, needs no JWT secret
 * in the environment, and honours revoked sessions.
 */

import { env, PublicError } from './http.mjs';

function bearerToken(request) {
  var header = request.headers.get('authorization') || '';

  if (!header.toLowerCase().startsWith('bearer ')) return null;

  var token = header.slice(7).trim();

  return token || null;
}

export async function requireUser(request) {
  var token = bearerToken(request);

  if (!token) throw new PublicError(401, 'Please sign in.');

  var response = await fetch(env('SUPABASE_URL').replace(/\/+$/, '') + '/auth/v1/user', {
    headers: {
      apikey: env('SUPABASE_ANON_KEY'),
      Authorization: 'Bearer ' + token
    }
  });

  if (!response.ok) throw new PublicError(401, 'Please sign in again.');

  var user = await response.json().catch(function () {
    return null;
  });

  if (!user || !user.id) throw new PublicError(401, 'Please sign in again.');

  return { id: user.id, email: user.email || null };
}

async function roleOf(userId) {
  var key = env('SUPABASE_SERVICE_ROLE_KEY');

  var response = await fetch(
    env('SUPABASE_URL').replace(/\/+$/, '') +
      '/rest/v1/user_roles?user_id=eq.' + encodeURIComponent(userId) + '&select=role',
    { headers: { apikey: key, Authorization: 'Bearer ' + key } }
  );

  if (!response.ok) {
    console.error('[auth] could not read user_roles', response.status);
    throw new Error('Role lookup failed');
  }

  var rows = await response.json();

  return rows && rows[0] ? rows[0].role : null;
}

/**
 * @returns {{ id, email, role }} for an admin or staff caller.
 * @throws  401 if not signed in; 404 (not 403) if signed in without a role,
 *          so an unauthorised caller learns nothing about the endpoint.
 */
export async function requireAdmin(request) {
  var user = await requireUser(request);
  var role = await roleOf(user.id);

  if (role !== 'admin' && role !== 'staff') {
    console.warn('[auth] non-admin reached an admin endpoint:', user.id);
    throw new PublicError(404, 'Not found.');
  }

  return { id: user.id, email: user.email, role: role };
}
