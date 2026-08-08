'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import {
  AuthenticationDetails,
  CognitoUser,
  type CognitoUserAttribute,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { userPool } from './cognito';

export type Role = 'owner' | 'admin' | 'user' | null;

/**
 * Deliberately minimal, and not Cognito's `CognitoUser`. The UI only ever displays an email, so
 * a narrow shape keeps the provider swappable and stops Cognito types leaking into components.
 */
export type AuthUser = {
  email: string;
  sub: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  role: Role;
  loading: boolean;
  /**
   * Resolves `{ newPasswordRequired: true }` when Cognito demands a password change before it
   * will issue tokens. This is NOT an edge case: the pool is admin-create-only, so EVERY user
   * hits it on first sign-in. Swallowing it would leave every new account unable to log in with
   * no visible error.
   */
  signIn: (email: string, password: string) => Promise<{ newPasswordRequired: boolean }>;
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

  // Restore an existing session on mount. getSession refreshes automatically using the stored
  // refresh token, so a returning user is not asked to sign in again for 30 days.
  useEffect(() => {
    const current = userPool.getCurrentUser();
    if (!current) {
      setLoading(false);
      return;
    }
    current.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (!err && session?.isValid()) {
        const { user: u, role: r } = fromSession(session);
        setUser(u);
        setRole(r);
      }
      setLoading(false);
    });
  }, []);

  const value: AuthContextValue = {
    user,
    role,
    loading,

    signIn: (email, password) =>
      new Promise((resolve, reject) => {
        const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
        cognitoUser.authenticateUser(
          new AuthenticationDetails({ Username: email, Password: password }),
          {
            onSuccess: (session) => {
              const { user: u, role: r } = fromSession(session);
              setUser(u);
              setRole(r);
              resolve({ newPasswordRequired: false });
            },
            onFailure: (err) => reject(err),
            newPasswordRequired: (attributes: Record<string, string>) => {
              pendingUser = cognitoUser;
              // Cognito rejects these as unmodifiable if echoed back in the challenge response.
              delete attributes['email_verified'];
              delete attributes['email'];
              pendingAttributes = attributes;
              resolve({ newPasswordRequired: true });
            },
          },
        );
      }),

    completeNewPassword: (email, newPassword) =>
      new Promise((resolve, reject) => {
        const cognitoUser = pendingUser ?? new CognitoUser({ Username: email, Pool: userPool });
        cognitoUser.completeNewPasswordChallenge(newPassword, pendingAttributes, {
          onSuccess: (session) => {
            const { user: u, role: r } = fromSession(session);
            setUser(u);
            setRole(r);
            pendingUser = null;
            resolve();
          },
          onFailure: (err) => reject(err),
        });
      }),

    signOut: async () => {
      userPool.getCurrentUser()?.signOut();
      setUser(null);
      setRole(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * The current ID token, refreshed if needed. `lib/api.ts` attaches it as a Bearer token.
 *
 * The ID token is used rather than the access token because the API authorises on the custom
 * attributes, and only the ID token carries them — `plugins/auth.ts` enforces `tokenUse: 'id'`,
 * so an access token here would be rejected as invalid.
 */
export async function getIdToken(): Promise<string | undefined> {
  const current = userPool.getCurrentUser();
  if (!current) return undefined;

  return new Promise((resolve) => {
    current.getSession((err: Error | null, session: CognitoUserSession | null) => {
      resolve(!err && session?.isValid() ? session.getIdToken().getJwtToken() : undefined);
    });
  });
}

export type { CognitoUserAttribute };
