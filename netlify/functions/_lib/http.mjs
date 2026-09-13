/**
 * HTTP — response helpers and request parsing shared by the functions.
 */

var JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

export function json(status, payload) {
  return new Response(JSON.stringify(payload), { status: status, headers: JSON_HEADERS });
}

export function ok(payload) {
  return json(200, payload);
}

/**
 * A message safe to show a shopper. Anything else is logged and replaced with
 * a generic line — internal errors never reach the browser.
 */
export class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

export function badRequest(message) {
  return new PublicError(400, message);
}

/** Wraps a handler so thrown errors become clean JSON responses. */
export function handle(name, handler) {
  return async function (request, context) {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof PublicError) {
        return json(error.status, { error: error.message });
      }

      console.error('[' + name + ']', error);

      return json(500, { error: 'Something went wrong on our side. Please try again.' });
    }
  };
}

export async function readJson(request) {
  if (request.method !== 'POST') {
    throw new PublicError(405, 'Method not allowed.');
  }

  try {
    return await request.json();
  } catch (error) {
    throw badRequest('Malformed request.');
  }
}

/** Reads a required environment variable, failing loudly at call time. */
export function env(name) {
  var value = process.env[name];

  if (!value) {
    throw new Error('Missing environment variable: ' + name);
  }

  return value;
}
