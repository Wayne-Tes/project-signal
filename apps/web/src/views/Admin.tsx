'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BrandManager } from '@/components/BrandManager';

type CreatedTenant = {
  status: string;
  data: {
    tenant: { id: string; name: string; slug: string };
    brand: { id: string; name: string };
    user: { id: string; role: string };
  };
};

export function AdminView() {
  const { user } = useAuth();
  const [tenantName, setTenantName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [adminUid, setAdminUid] = useState(user?.uid ?? '');
  const [result, setResult] = useState<CreatedTenant | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const data = await apiFetch<CreatedTenant>('/admin/tenants', {
        method: 'POST',
        body: JSON.stringify({
          tenantName,
          brandName,
          adminFirebaseUid: adminUid,
        }),
      });
      setResult(data);
      setTenantName('');
      setBrandName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tenant');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={card}>
        <h2 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 18, margin: '0 0 4px' }}>
          Create tenant
        </h2>
        <p style={{ color: '#8a8f99', fontSize: 13, margin: '0 0 20px' }}>
          Provisions a tenant, its owned brand, and an admin user.
        </p>
        <form onSubmit={submit}>
          <label style={lbl} htmlFor="tenantName">
            Tenant name
          </label>
          <input
            id="tenantName"
            style={inp}
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            placeholder="Acme Corp"
            required
          />
          <label style={lbl} htmlFor="brandName">
            Brand name
          </label>
          <input
            id="brandName"
            style={inp}
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="Acme"
            required
          />
          <label style={lbl} htmlFor="adminUid">
            Admin Firebase UID
          </label>
          <input
            id="adminUid"
            style={inp}
            value={adminUid}
            onChange={(e) => setAdminUid(e.target.value)}
            placeholder="firebase uid of the tenant admin"
            required
          />
          {error && <p style={{ color: '#e2725b', fontSize: 13, margin: '12px 0 0' }}>{error}</p>}
          <button type="submit" disabled={busy} style={btn}>
            {busy ? 'Creating…' : 'Create tenant'}
          </button>
        </form>
      </div>

      {result && (
        <div style={{ ...card, marginTop: 16, borderColor: '#2c5e4f' }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#5dcaa5' }}>Tenant created</h3>
          <dl style={{ margin: 0, fontSize: 13, color: '#c9ccd3' }}>
            <Row label="Tenant" value={`${result.data.tenant.name} (${result.data.tenant.slug})`} />
            <Row label="Tenant ID" value={result.data.tenant.id} />
            <Row label="Brand" value={result.data.brand.name} />
            <Row label="Admin role" value={result.data.user.role} />
          </dl>
        </div>
      )}

      <BrandManager />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
      <dt style={{ color: '#8a8f99', minWidth: 90 }}>{label}</dt>
      <dd style={{ margin: 0, fontFamily: 'IBM Plex Mono, monospace' }}>{value}</dd>
    </div>
  );
}

const card: CSSProperties = {
  padding: 24,
  background: '#101217',
  border: '1px solid #1e2128',
  borderRadius: 14,
};
const lbl: CSSProperties = { display: 'block', fontSize: 12, color: '#8a8f99', margin: '12px 0 4px' };
const inp: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#0b0c0f',
  border: '1px solid #1e2128',
  borderRadius: 8,
  color: '#e8e8ea',
  fontSize: 14,
  boxSizing: 'border-box',
};
const btn: CSSProperties = {
  marginTop: 20,
  padding: '10px 18px',
  background: '#5dcaa5',
  color: '#06241b',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
