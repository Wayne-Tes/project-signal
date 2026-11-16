import { API_BASE } from './config';

/**
 * The local-development identity provider.
 *
 * Talks to `POST /auth/local/sign-in`, which the API registers ONLY when it runs with
 * `AUTH_MODE=local` (and which it refuses to do under `NODE_ENV=production`). Nothing here is
 * reachable from a Cognito build: `AUTH_MODE` is inlined at build time and every caller branches
 * on it.
 *
 * The token lives in sessionStorage, not localStorage: a local session should end with the tab,
 * and nothing about local development benefits from surviving a browser restart.
 */

export interface LocalUser {
  username: string;
  role: 'owner' | 'admin' | 'user';
  tenantId: string;
  brandEntityId: string | null;
}

interface LocalSession {
  token: string;
  user: LocalUser;
}

const KEY = 'ps.local-session';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    // Storage can be disabled outright (privacy modes); treat as "no session".
    return null;
  }
}

/** The stored session, or null when there is none or it is unreadable. */
export function readLocalSession(): LocalSession | null {
  const raw = storage()?.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalSession>;
    if (
      typeof parsed.token !== 'string' ||
      !parsed.user ||
      typeof parsed.user.username !== 'string'
    ) {
      return null;
    }
    return parsed as LocalSession;
  } catch {
    return null;
  }
}

export function clearLocalSession(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* A storage that refuses a delete has nothing we can do about it; the in-memory state is
       what gates the UI, and that is cleared by the caller. */
  }
}

/**
 * Exchanges a username and password for a session.
 *
 * The thrown message is deliberately generic for a 401 — the API does not say WHICH half was
 * wrong, and neither should the UI.
 */
export async function localSignIn(username: string, password: string): Promise<LocalSession> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/local/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error(`Could not reach the API at ${API_BASE}. Is it running?`);
  }

  if (res.status === 401) throw new Error('Sign-in failed — check your username and password.');
  if (res.status === 404) {
    throw new Error(
      'The API has no local sign-in. Start it with AUTH_MODE=local, or build the web app without NEXT_PUBLIC_AUTH_MODE=local.',
    );
  }
  if (res.status === 429)
    throw new Error('Too many sign-in attempts. Wait a minute and try again.');
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}).`);

  const session = (await res.json()) as Partial<LocalSession>;
  if (typeof session.token !== 'string' || !session.user) {
    throw new Error('The API returned an unexpected sign-in response.');
  }
  const value = session as LocalSession;
  try {
    storage()?.setItem(KEY, JSON.stringify(value));
  } catch {
    /* Signed in for this page only; a reload will ask again. Better than failing the sign-in. */
  }
  return value;
}
