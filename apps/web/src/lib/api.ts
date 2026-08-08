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
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}
