'use client';

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Role = 'owner' | 'admin' | 'user';

type User = {
  id: string;
  firebaseUid: string;
  tenantId: string;
  role: Role;
  brandEntityId: string | null;
};

type Brand = { id: string; name: string };

/**
 * Roles the signed-in operator may assign. Mirrors the API: an admin provisions their own
 * tenant below owner, an owner is unconstrained. The server enforces this regardless — the
 * UI only avoids offering a choice that would be rejected.
 */
function assignableRoles(actorRole: Role | null): Role[] {
  return actorRole === 'owner' ? ['owner', 'admin', 'user'] : ['admin', 'user'];
}

export function UserManager() {
  const { role: actorRole } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [firebaseUid, setFirebaseUid] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [brandEntityId, setBrandEntityId] = useState('');

  const roles = assignableRoles(actorRole as Role | null);

  const load = useCallback(async () => {
    try {
      const [rows, brandRows] = await Promise.all([
        apiFetch<User[]>('/admin/users'),
        apiFetch<Brand[]>('/brands'),
      ]);
      setUsers(rows);
      setBrands(brandRows);
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
      const tenantId = users[0]?.tenantId ?? '';
      await apiFetch<User>('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          firebaseUid,
          email,
          role,
          tenantId,
          ...(brandEntityId ? { brandEntityId } : {}),
        }),
      });
      setFirebaseUid('');
      setEmail('');
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
        Provision users for this tenant and set their role.
        {actorRole !== 'owner' && ' Admins cannot create or modify owners.'}
      </p>

      {error && (
        <p style={errorText} role="alert">
          {error}
        </p>
      )}
      {notice && <p style={noticeText}>{notice}</p>}

      {users.length === 0 ? (
        <p style={muted}>No users yet.</p>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Firebase UID</th>
              <th style={th}>Role</th>
              <th style={th}>Brand</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{u.firebaseUid}</td>
                <td style={td}>
                  <select
                    aria-label={`Role for ${u.firebaseUid}`}
                    style={select}
                    value={u.role}
                    disabled={actorRole !== 'owner' && u.role === 'owner'}
                    onChange={(e) => void changeRole(u.id, e.target.value as Role)}
                  >
                    {/* Keep the current role visible even when not assignable by this actor. */}
                    {Array.from(new Set([u.role, ...roles])).map((r) => (
                      <option key={r} value={r} disabled={!roles.includes(r)}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ ...td, color: 'var(--t3)' }}>
                  {brands.find((b) => b.id === u.brandEntityId)?.name ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={create} style={{ marginTop: 20 }}>
        <label style={lbl} htmlFor="newUserUid">
          Firebase UID
        </label>
        <input
          id="newUserUid"
          style={inp}
          value={firebaseUid}
          onChange={(e) => setFirebaseUid(e.target.value)}
          placeholder="Cognito sub of the new user"
          required
        />
        <label style={lbl} htmlFor="newUserEmail">
          Email
        </label>
        <input
          id="newUserEmail"
          type="email"
          style={inp}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="person@example.com"
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
          {roles.map((r) => (
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
  background: 'var(--mint)',
  color: 'var(--bg)',
  border: 'none',
  borderRadius: 'var(--r-sm)',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
