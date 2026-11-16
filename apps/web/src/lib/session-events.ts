/**
 * "The API no longer accepts this session" — raised by the API client, handled by AuthProvider.
 *
 * A token can stop working while the app is open: a Cognito refresh token expires or is revoked,
 * a local-development API restarts with a different password. Before this existed, requests simply
 * went out without a token (or with a dead one), every view rendered "Could not load this view",
 * and nothing ever sent the user back to sign in. One signal, raised wherever a 401 is seen, fixes
 * that for every caller at once.
 *
 * An event rather than an import: `lib/api.ts` must not depend on the React auth provider, and the
 * provider must not wrap every fetch.
 */

const EVENT = 'ps:session-expired';

export function notifySessionExpired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENT));
}

/** Subscribes; returns the unsubscribe function. */
export function onSessionExpired(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
