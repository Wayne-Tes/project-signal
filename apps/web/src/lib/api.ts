import { getIdToken } from './auth';

// Defaults to the local API. In deployed environments NEXT_PUBLIC_API_URL must be supplied as a
// Docker build arg — it is inlined at build time, so a runtime env var has no effect
// (docs/KNOWN-GAPS.md #8).
//
// On AWS the web app and the API sit behind the SAME load balancer, so this is the ALB's own
// origin. Same-origin means no CORS preflight and no CORS_ORIGINS allowlist to maintain.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

/** Fetch the API with the current user's Cognito ID token attached. */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      /* Content-Type ONLY when there is a body.

         It used to be sent unconditionally, which made every body-less POST fail: Fastify sees
         `application/json`, finds nothing to parse, and rejects with 400 "Body cannot be empty
         when content-type is set to application/json" — before the route handler runs at all.
         POST /brands/:id/scan takes no body, so the scan button returned 400 every time and
         never reached the API's logic. The response came back in two milliseconds, which is what
         gave it away: too fast to have touched the database. */
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${messageFrom(body) || res.statusText}`);
  }
  /* 204 and other empty responses have no JSON to parse. `DELETE` returns 204, and calling
     .json() on it throws a SyntaxError that surfaces to the user as a failure of an operation
     that in fact succeeded. */
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

/**
 * The human sentence inside an error response.
 *
 * The API answers a failure with a JSON envelope, and this used to be shown to the user raw.
 * Adding a feed that already existed produced, on screen, in red:
 *
 *   API 409: {"status":"error","error":"This exact feed is already configured for this
 *   brand.","data":{"id":"089b9c69-b327-4671-9a90-cf66c37d3de2"}}
 *
 * The sentence a person needs is in there, wrapped in punctuation and a uuid that means nothing
 * to them. Every caller in the app shows these messages verbatim — deliberately, because the API
 * names the specific thing in the way and a generic "could not save" throws that away — so the
 * unwrapping belongs here, once, rather than in each catch block.
 *
 * Falls back to the raw body when it is not the expected shape. A truncated or unexpected error
 * is still better shown than swallowed.
 */
function messageFrom(body: string): string {
  if (!body) return '';
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      /* Fastify's own errors use `message`; this codebase's envelopes use `error`. */
      for (const key of ['error', 'message']) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }
  } catch {
    /* Not JSON — an ALB error page, a proxy timeout. Show it as it came. */
  }
  return body;
}
