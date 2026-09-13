/**
 * Auth — admin sign-in (email + password via Supabase Auth).
 *
 * Everything here is for convenience and display. Nothing in this file is
 * a security boundary: the browser decides what to *show*, row-level
 * security decides what can be *read*, and the Netlify functions decide
 * what can be *changed*. Editing this file in devtools gains nothing.
 */

import { getSupabase } from './supabase.js';

var listeners = new Set();
var current = { status: 'unknown', user: null };
var started = false;

function publish(status, user) {
  current = { status: status, user: user };

  listeners.forEach(function (listener) {
    listener(current);
  });
}

/** Starts session tracking. Safe to call from every page; runs once. */
export function startAuth() {
  if (started) return;
  started = true;

  getSupabase()
    .then(async function (supabase) {
      var result = await supabase.auth.getSession();
      var session = result.data ? result.data.session : null;

      publish(session ? 'signed-in' : 'signed-out', session ? session.user : null);

      supabase.auth.onAuthStateChange(function (event, nextSession) {
        publish(nextSession ? 'signed-in' : 'signed-out',
          nextSession ? nextSession.user : null);
      });
    })
    .catch(function (error) {
      console.warn('[auth] unavailable:', error.message);
      publish('unavailable', null);
    });
}

/** Calls `listener` now with the current state, and on every change. */
export function onAuthChange(listener) {
  listeners.add(listener);
  listener(current);

  return function unsubscribe() {
    listeners.delete(listener);
  };
}

export async function signInWithPassword(email, password) {
  var supabase = await getSupabase();
  var result = await supabase.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (result.error) {
    throw new Error('Sign-in failed. Check the email and password.');
  }

  return result.data.user;
}

export async function signOut() {
  var supabase = await getSupabase();
  await supabase.auth.signOut();
}

/** fetch() with the caller's access token attached, for the admin APIs. */
export async function authedFetch(url, options) {
  var supabase = await getSupabase();
  var result = await supabase.auth.getSession();
  var token = result.data && result.data.session
    ? result.data.session.access_token
    : null;

  var merged = Object.assign({}, options);
  merged.headers = Object.assign({}, options && options.headers);

  if (token) merged.headers.Authorization = 'Bearer ' + token;

  return fetch(url, merged);
}
