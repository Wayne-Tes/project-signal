'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AuthenticationDetails,
  CognitoUser,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { getUserPool } from './cognito';
import { AUTH_MODE, type AuthMode } from './config';
import { clearLocalSession, localSignIn, readLocalSession, type LocalUser } from './local-auth';
import { onSessionExpired } from './session-events';

export type Role = 'owner' | 'admin' | 'user' | null;

/**
 * Deliberately minimal, and not Cognito's `CognitoUser`. The UI only ever displays an identifier,
 * so a narrow shape keeps the provider swappable and stops Cognito types leaking into components.
 * In local mode `email` carries the local username — it is what the shell displays.
 */
export type AuthUser = {
  email: string;
  sub: string;
};

export type AuthContextValue = {
  /** Which provider this build signs in against. Inlined at build time; never changes at runtime. */
  mode: AuthMode;
  user: AuthUser | null;
  role: Role;
  loading: boolean;
  /**
   * True when the user was signed out because the API rejected their session, rather than by
   * choice. The sign-in screen says so — otherwise an expired session looks like the app forgetting
   * who you are for no reason.
   */
  expired: boolean;
  /**
   * Resolves `{ newPasswordRequired: true }` when Cognito demands a password change before it
   * will issue tokens. This is NOT an edge case: the pool is admin-create-only, so EVERY user
   * hits it on first sign-in. Swallowing it would leave every new account unable to log in with
   * no visible error. Local mode never requires it.
   */
  signIn: (identifier: string, password: string) => Promise<{ newPasswordRequired: boolean }>;
  completeNewPassword: (email: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Reads the claims this app cares about off a verified session's ID token. */
function fromSession(session: CognitoUserSession): { user: AuthUser; role: Role } {
  const claims = session.getIdToken().payload as Record<string, unknown>;
  return {
    user: {
      email: (claims['email'] as string) ?? '',
      sub: (claims['sub'] as string) ?? '',
    },
    // Cognito prefixes custom attributes with `custom:`; the prefix is not configurable. The
    // fallback matches the API, which treats a token with no role as unauthorised rather than
    // guessing — here it only affects which nav items render.
    role: (claims['custom:role'] as Role) ?? null,
  };
}

function fromLocal(user: LocalUser): { user: AuthUser; role: Role } {
  return { user: { email: user.username, sub: user.username }, role: user.role };
}

/** Resolves the current Cognito session, or null when there is none or it cannot be refreshed. */
async function currentCognitoSession(): Promise<{
  cognitoUser: CognitoUser;
  session: CognitoUserSession;
} | null> {
  // `async` so a missing-config throw from getUserPool() becomes a rejection the callers handle,
  // rather than a synchronous throw inside an effect.
  const cognitoUser = getUserPool().getCurrentUser();
  if (!cognitoUser) return null;
  return new Promise((resolve) => {
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      resolve(!err && session?.isValid() ? { cognitoUser, session } : null);
    });
  });
}

/**
 * Held between signIn and completeNewPassword. The Cognito SDK requires the SAME CognitoUser
 * instance to complete the challenge — a fresh one has no challenge state and fails with an
 * opaque error.
 */
let pendingUser: CognitoUser | null = null;
let pendingAttributes: Record<string, string> = {};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  const apply = useCallback((next: { user: AuthUser; role: Role } | null): void => {
    setUser(next?.user ?? null);
    setRole(next?.role ?? null);
  }, []);

  // Restore an existing session on mount. In Cognito mode getSession refreshes automatically
  // using the stored refresh token, so a returning user is not asked to sign in again for 30 days.
  useEffect(() => {
    let cancelled = false;
    if (AUTH_MODE === 'local') {
      const session = readLocalSession();
      apply(session ? fromLocal(session.user) : null);
      setLoading(false);
      return;
    }
    void currentCognitoSession()
      .then((found) => {
        if (!cancelled) apply(found ? fromSession(found.session) : null);
      })
      .catch(() => {
        /* A broken stored session is "signed out", not a crash on the sign-in screen. */
        if (!cancelled) apply(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // The API rejected the session mid-use: drop it and return to sign-in, saying why.
  useEffect(
    () =>
      onSessionExpired(() => {
        if (AUTH_MODE === 'local') clearLocalSession();
        else getUserPool().getCurrentUser()?.signOut();
        apply(null);
        setExpired(true);
      }),
    [apply],
  );

  const signIn = useCallback<AuthContextValue['signIn']>(
    async (identifier, password) => {
      setExpired(false);
      if (AUTH_MODE === 'local') {
        const session = await localSignIn(identifier, password);
        apply(fromLocal(session.user));
        return { newPasswordRequired: false };
      }
      return new Promise((resolve, reject) => {
        const cognitoUser = new CognitoUser({ Username: identifier, Pool: getUserPool() });
        cognitoUser.authenticateUser(
          new AuthenticationDetails({ Username: identifier, Password: password }),
          {
            onSuccess: (session) => {
              apply(fromSession(session));
              resolve({ newPasswordRequired: false });
            },
            onFailure: (err) => reject(err),
            newPasswordRequired: () => {
              pendingUser = cognitoUser;

              // Send back NOTHING. The challenge response may only carry attributes the app
              // client is permitted to WRITE, and Terraform grants this client
              // `write_attributes = ["email"]` alone — so echoing the callback's userAttributes
              // back (which include sub, email_verified, custom:role and custom:tenantId) fails
              // the whole password change with:
              //
              //   Input attributes include non-writable attributes for the client <id>
              //
              // The custom attributes are exactly the ones a client must never be able to
              // rewrite — a user who could set their own custom:role would promote themselves.
              // An empty object is correct: email is already set and verified by the admin-create
              // path, and the pool marks no attribute as required.
              pendingAttributes = {};
              resolve({ newPasswordRequired: true });
            },
          },
        );
      });
    },
    [apply],
  );

  const completeNewPassword = useCallback<AuthContextValue['completeNewPassword']>(
    (email, newPassword) =>
      new Promise((resolve, reject) => {
        const cognitoUser =
          pendingUser ?? new CognitoUser({ Username: email, Pool: getUserPool() });
        cognitoUser.completeNewPasswordChallenge(newPassword, pendingAttributes, {
          onSuccess: (session) => {
            apply(fromSession(session));
            pendingUser = null;
            resolve();
          },
          onFailure: (err) => reject(err),
        });
      }),
    [apply],
  );

  const signOut = useCallback<AuthContextValue['signOut']>(async () => {
    setExpired(false);
    if (AUTH_MODE === 'local') {
      clearLocalSession();
      apply(null);
      return;
    }
    /* GLOBAL sign-out revokes the refresh token server-side, so a copied token stops working too.
       The local signOut() it replaced only forgot the tokens in this browser, leaving the refresh
       token valid for its full 30 days. Falls back to the local clear when the global call cannot
       be made (no session, network down): the user asked to be signed out, and this browser at
       least must honour that. */
    const found = await currentCognitoSession().catch(() => null);
    if (found) {
      await new Promise<void>((resolve) => {
        found.cognitoUser.globalSignOut({ onSuccess: () => resolve(), onFailure: () => resolve() });
      });
    }
    getUserPool().getCurrentUser()?.signOut();
    apply(null);
  }, [apply]);

  /* Memoised: an unmemoised value re-rendered every consumer — the whole app — on every render of
     the provider, whether or not anything about the session had changed. */
  const value = useMemo<AuthContextValue>(
    () => ({
      mode: AUTH_MODE,
      user,
      role,
      loading,
      expired,
      signIn,
      completeNewPassword,
      signOut,
    }),
    [user, role, loading, expired, signIn, completeNewPassword, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * The current bearer token, refreshed if needed. `lib/api.ts` attaches it.
 *
 * Cognito: the ID token rather than the access token, because the API authorises on the custom
 * attributes and only the ID token carries them — `plugins/auth.ts` enforces `tokenUse: 'id'`.
 * Local: the token the API's local sign-in issued.
 */
export async function getIdToken(): Promise<string | undefined> {
  if (AUTH_MODE === 'local') return readLocalSession()?.token;
  const found = await currentCognitoSession().catch(() => null);
  return found?.session.getIdToken().getJwtToken();
}
