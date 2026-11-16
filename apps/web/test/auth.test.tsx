import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Sign-in, in both modes, through the REAL AuthProvider, AuthGate and SignIn.
 *
 * Only the edges are replaced: the build-time config (so one file can test both modes), `fetch`
 * (the local sign-in endpoint), and the Cognito SDK (which would otherwise call AWS).
 */

const config = vi.hoisted(() => ({ mode: 'local' as 'local' | 'cognito' }));
vi.mock('@/lib/config', () => ({
  get AUTH_MODE() {
    return config.mode;
  },
  API_BASE: 'http://api.test',
}));

/* ---------- a scriptable stand-in for amazon-cognito-identity-js ---------- */
const cognito = vi.hoisted(() => {
  const state = {
    current: null as null | FakeUser,
    behaviour: 'success' as 'success' | 'fail' | 'challenge',
    sessionValid: true,
    globalSignOutCalls: 0,
    signOutCalls: 0,
  };
  const session = (role = 'admin') => ({
    isValid: () => state.sessionValid,
    getIdToken: () => ({
      payload: { email: 'a@b.c', sub: 'sub-1', 'custom:role': role },
      getJwtToken: () => 'jwt-token',
    }),
  });
  class FakeUser {
    constructor(public readonly data: { Username: string }) {}
    getSession(cb: (err: Error | null, s: unknown) => void) {
      cb(null, session());
    }
    authenticateUser(
      _d: unknown,
      cbs: {
        onSuccess: (s: unknown) => void;
        onFailure: (e: Error) => void;
        newPasswordRequired: () => void;
      },
    ) {
      if (state.behaviour === 'fail') cbs.onFailure(new Error('NotAuthorizedException'));
      else if (state.behaviour === 'challenge') cbs.newPasswordRequired();
      else {
        state.current = this;
        cbs.onSuccess(session());
      }
    }
    completeNewPasswordChallenge(
      pw: string,
      _attrs: unknown,
      cbs: { onSuccess: (s: unknown) => void; onFailure: (e: Error) => void },
    ) {
      if (pw === 'short') cbs.onFailure(new Error('Password does not conform to policy'));
      else {
        state.current = this;
        cbs.onSuccess(session('user'));
      }
    }
    globalSignOut(cbs: { onSuccess: () => void }) {
      state.globalSignOutCalls += 1;
      cbs.onSuccess();
    }
    signOut() {
      state.signOutCalls += 1;
      state.current = null;
    }
  }
  return { state, FakeUser };
});

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: class {
    getCurrentUser() {
      return cognito.state.current;
    }
  },
  CognitoUser: cognito.FakeUser,
  AuthenticationDetails: class {},
}));

const fetchMock = vi.fn();

const { AuthProvider, useAuth, getIdToken } = await import('../src/lib/auth');
const { AuthGate } = await import('../src/components/AuthGate');
const { notifySessionExpired, onSessionExpired } = await import('../src/lib/session-events');

function SignedIn() {
  const { user, role, signOut } = useAuth();
  return (
    <div>
      <p>Signed in as {user?.email}</p>
      <p>Role {role}</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

function app() {
  return render(
    <AuthProvider>
      <AuthGate>
        <SignedIn />
      </AuthGate>
    </AuthProvider>,
  );
}

async function fillAndSubmit(identifier: string, password: string) {
  await userEvent.type(await screen.findByLabelText(/username|email/i), identifier);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  cognito.state.current = null;
  cognito.state.behaviour = 'success';
  cognito.state.sessionValid = true;
  cognito.state.globalSignOutCalls = 0;
  cognito.state.signOutCalls = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local mode', () => {
  beforeEach(() => {
    config.mode = 'local';
  });

  it('is labelled as local development and asks for a username', async () => {
    app();
    expect(await screen.findByTestId('local-auth-badge')).toHaveTextContent(
      'Local development sign-in',
    );
    expect(screen.getByLabelText('Username')).toHaveAttribute('type', 'text');
  });

  it('signs in against the API, stores the session for the tab, and attaches its token', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'dev:owner:t-1',
          user: { username: 'local-owner', role: 'owner', tenantId: 't-1', brandEntityId: null },
        }),
        { status: 200 },
      ),
    );
    app();
    await fillAndSubmit('local-owner', 'correct horse');
    expect(await screen.findByText('Signed in as local-owner')).toBeInTheDocument();
    expect(screen.getByText('Role owner')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/auth/local/sign-in');
    expect(JSON.parse(String(init.body))).toEqual({
      username: 'local-owner',
      password: 'correct horse',
    });
    expect(sessionStorage.getItem('ps.local-session')).toContain('dev:owner:t-1');
    expect(await getIdToken()).toBe('dev:owner:t-1');
  });

  it('restores a stored session on load, and signing out clears it', async () => {
    sessionStorage.setItem(
      'ps.local-session',
      JSON.stringify({
        token: 'tok',
        user: { username: 'local-admin', role: 'admin', tenantId: 't', brandEntityId: null },
      }),
    );
    app();
    expect(await screen.findByText('Signed in as local-admin')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(sessionStorage.getItem('ps.local-session')).toBeNull();
  });

  it('ignores a corrupted stored session rather than crashing', async () => {
    sessionStorage.setItem('ps.local-session', '{not json');
    app();
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    sessionStorage.setItem('ps.local-session', JSON.stringify({ token: 1 }));
    expect(await getIdToken()).toBeUndefined();
  });

  it.each([
    [401, /check your username and password/i],
    [404, /no local sign-in/i],
    [429, /too many sign-in attempts/i],
    [500, /sign-in failed \(500\)/i],
  ])('explains a %s', async (status, message) => {
    fetchMock.mockResolvedValue(new Response('{}', { status }));
    app();
    await fillAndSubmit('local-owner', 'nope');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('explains an unreachable API', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    app();
    await fillAndSubmit('local-owner', 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the api/i);
  });

  it('rejects a malformed success response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    app();
    await fillAndSubmit('local-owner', 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent(/unexpected sign-in response/i);
  });

  it('returns to sign-in, saying why, when the API rejects the session mid-use', async () => {
    sessionStorage.setItem(
      'ps.local-session',
      JSON.stringify({
        token: 'tok',
        user: { username: 'local-user', role: 'user', tenantId: 't', brandEntityId: 'b' },
      }),
    );
    app();
    await screen.findByText('Signed in as local-user');
    act(() => notifySessionExpired());
    expect(await screen.findByText(/your session has ended/i)).toBeInTheDocument();
    expect(sessionStorage.getItem('ps.local-session')).toBeNull();
  });
});

describe('cognito mode', () => {
  beforeEach(() => {
    config.mode = 'cognito';
    vi.stubEnv('NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'eu-west-2_TestPool');
    vi.stubEnv('NEXT_PUBLIC_COGNITO_CLIENT_ID', 'test-client');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('asks for an email, signs in and reads the role from the token claims', async () => {
    app();
    expect(await screen.findByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.queryByTestId('local-auth-badge')).not.toBeInTheDocument();
    await fillAndSubmit('a@b.c', 'pw');
    expect(await screen.findByText('Signed in as a@b.c')).toBeInTheDocument();
    expect(screen.getByText('Role admin')).toBeInTheDocument();
    expect(await getIdToken()).toBe('jwt-token');
  });

  it('shows a generic message on failure', async () => {
    cognito.state.behaviour = 'fail';
    app();
    await fillAndSubmit('a@b.c', 'bad');
    expect(await screen.findByRole('alert')).toHaveTextContent(/check your email and password/i);
  });

  it('walks a first sign-in through the forced password change', async () => {
    cognito.state.behaviour = 'challenge';
    app();
    await fillAndSubmit('a@b.c', 'temp');
    const fresh = await screen.findByLabelText('New password');
    await userEvent.type(fresh, 'short');
    await userEvent.click(screen.getByRole('button', { name: /set password/i }));
    /* Cognito's own policy message, not "sign-in failed". */
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not conform/i);
    await userEvent.clear(fresh);
    await userEvent.type(fresh, 'Long-enough-Passw0rd!');
    await userEvent.click(screen.getByRole('button', { name: /set password/i }));
    expect(await screen.findByText('Role user')).toBeInTheDocument();
  });

  it('restores an existing session, and signs out GLOBALLY so the refresh token is revoked', async () => {
    cognito.state.current = new cognito.FakeUser({ Username: 'a@b.c' });
    app();
    expect(await screen.findByText('Signed in as a@b.c')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Email');
    expect(cognito.state.globalSignOutCalls).toBe(1);
    expect(cognito.state.signOutCalls).toBe(1);
  });

  it('treats an invalid stored session as signed out', async () => {
    cognito.state.current = new cognito.FakeUser({ Username: 'a@b.c' });
    cognito.state.sessionValid = false;
    app();
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(await getIdToken()).toBeUndefined();
  });

  it('returns to sign-in when the API rejects the session', async () => {
    cognito.state.current = new cognito.FakeUser({ Username: 'a@b.c' });
    app();
    await screen.findByText('Signed in as a@b.c');
    act(() => notifySessionExpired());
    expect(await screen.findByText(/your session has ended/i)).toBeInTheDocument();
  });
});

describe('session events', () => {
  it('delivers to subscribers until they unsubscribe', () => {
    const handler = vi.fn();
    const off = onSessionExpired(handler);
    notifySessionExpired();
    off();
    notifySessionExpired();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('useAuth outside its provider', () => {
  it('fails loudly', () => {
    const Probe = () => {
      useAuth();
      return null;
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/within AuthProvider/);
  });
});

/* Keep the waitFor import honest for future async assertions. */
void waitFor;
