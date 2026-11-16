'use client';

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBrand } from '@/lib/brand-context';

type Role = 'owner' | 'admin' | 'user';

type User = {
  id: string;
  /** The identity provider's user id: the Cognito `sub` (or a local username). */
  cognitoSub: string;
  tenantId: string;
  role: Role;
  brandEntityId: string | null;
};

/**
 * The roles this panel can assign: admin and user, for every operator.
 *
 * `owner` is NEVER offered — not even to an owner. Owner is the platform operator's role, it
 * crosses tenants, and granting it is a deliberate out-of-band act rather than a dropdown choice.
 * This panel previously offered it to owners, so one mis-click on a row made a tenant user a
 * cross-tenant super-admin. The API enforces its own rules regardless; the UI must simply never
 * present escalation as an ordinary option.
 */
export const ASSIGNABLE_ROLES: readonly Role[] = ['admin', 'user'];

export function UserManager() {
  const { role: actorRole } = useAuth();
  /* The tenant's brands come from the shared provider rather than a second /brands request: the
     shell already holds them, and a private copy here went stale the moment a brand was added. */
  const { brands } = useBrand();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [subject, setSubject] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [brandEntityId, setBrandEntityId] = useState('');

  const load = useCallback(async () => {
    try {
      setUsers(await apiFetch<User[]>('/admin/users'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await apiFetch<User>('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          /* No tenantId: the API places the user in the caller's own tenant. Sending
             `users[0]?.tenantId` sent an empty string for a tenant with no users yet. */
          cognitoSub: subject,
          role,
          ...(brandEntityId ? { brandEntityId } : {}),
        }),
      });
      setSubject('');
      setBrandEntityId('');
      setNotice('User provisioned. They must sign in again for the new claims to apply.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create user');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(id: string, next: Role) {
    setError('');
    setNotice('');
    try {
      await apiFetch<User>(`/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: next }),
      });
      setNotice('Role updated. The token refreshes within the hour, or on next sign-in.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role');
    }
  }

  return (
    <div style={{ ...card, marginTop: 16 }} data-testid="user-manager">
      <h2 style={heading}>Manage users</h2>
      <p style={muted}>
        Provision users for this tenant and set their role. Owner is a platform role and is not
        assigned here.
        {actorRole !== 'owner' && ' Admins cannot modify owners.'}
      </p>

      {error && (
        <p style={errorText} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p style={noticeText} role="status">
          {notice}
        </p>
      )}

      {users.length === 0 ? (
        <p style={muted}>No users yet.</p>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Cognito sub</th>
              <th style={th}>Role</th>
              <th style={th}>Brand</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{u.cognitoSub}</td>
                <td style={td}>
                  {u.role === 'owner' ? (
                    /* An owner's role is shown, not offered: it is not changeable from here, and
                       a select that contained "owner" as an option is exactly the escalation
                       surface this panel must not present. */
                    <span title="Owner is a platform role and is not managed here">owner</span>
                  ) : (
                    <select
                      aria-label={`Role for ${u.cognitoSub}`}
                      style={select}
                      value={u.role}
                      onChange={(e) => void changeRole(u.id, e.target.value as Role)}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td style={{ ...td, color: 'var(--t3)' }}>
                  {brands.find((b) => b.id === u.brandEntityId)?.name ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={(e) => void create(e)} style={{ marginTop: 20 }}>
        <label style={lbl} htmlFor="newUserUid">
          Cognito user ID (sub)
        </label>
        <input
          id="newUserUid"
          style={inp}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Cognito sub of the new user"
          required
        />
        <label style={lbl} htmlFor="newUserRole">
          Role
        </label>
        <select
          id="newUserRole"
          style={inp}
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label style={lbl} htmlFor="newUserBrand">
          Pinned brand (optional — restricts a `user` to one brand)
        </label>
        <select
          id="newUserBrand"
          style={inp}
          value={brandEntityId}
          onChange={(e) => setBrandEntityId(e.target.value)}
        >
          <option value="">No pin — all tenant brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} style={btn}>
          {busy ? 'Provisioning…' : 'Provision user'}
        </button>
      </form>
    </div>
  );
}

// House rule: style with CSS custom properties, never literal hex — literals break the
// runtime palette switcher.
const card: CSSProperties = {
  padding: 24,
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r)',
};
const heading: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 18,
  margin: '0 0 4px',
};
const muted: CSSProperties = { color: 'var(--t3)', fontSize: 13, margin: '0 0 16px' };
const errorText: CSSProperties = { color: 'var(--coral)', fontSize: 13, margin: '0 0 12px' };
const noticeText: CSSProperties = { color: 'var(--mint)', fontSize: 13, margin: '0 0 12px' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: CSSProperties = {
  textAlign: 'left',
  color: 'var(--t3)',
  fontWeight: 500,
  padding: '6px 8px',
  borderBottom: '1px solid var(--line)',
};
const td: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--line)',
  color: 'var(--t2)',
};
const lbl: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--t3)',
  margin: '12px 0 4px',
};
const inp: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--t1)',
  fontSize: 14,
  boxSizing: 'border-box',
};
const select: CSSProperties = {
  padding: '4px 8px',
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--t1)',
  fontSize: 13,
};
const btn: CSSProperties = {
  marginTop: 20,
  padding: '10px 18px',
  /* The user's chosen highlight, not the status ramp. `--mint` is the legacy "positive" colour
     and painted this action olive regardless of the accent selected. `--accent-on` rather than
     `--bg`: the page background is not a text colour, and on a light theme it produced
     near-white text on lime. */
  background: 'var(--accent)',
  color: 'var(--accent-on)',
  border: 'none',
  borderRadius: 'var(--r-sm)',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
