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
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  /* 204 and other empty responses have no JSON to parse. `DELETE` returns 204, and calling
     .json() on it throws a SyntaxError that surfaces to the user as a failure of an operation
     that in fact succeeded. */
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
