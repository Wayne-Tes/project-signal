'use client';

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api';

type Brand = { id: string; name: string; slug: string; isOwned: boolean };
type SourceConfig = {
  id: string;
  source: string;
  isEnabled: boolean;
  config: Record<string, string>;
  lastFetchedAt: string | null;
};
type Alias = { id: string; alias: string };
type Envelope<T> = { status: string; data: T };

// Config fields each source type needs. Drives the dynamic add-source form.
const SOURCE_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  rss: [{ key: 'feedUrl', label: 'Feed URL', placeholder: 'https://example.com/feed.xml' }],
  youtube: [{ key: 'channelId', label: 'Channel ID', placeholder: 'UCxxxxxxxxxxxx' }],
  app_store: [
    { key: 'appId', label: 'App ID', placeholder: '284882215' },
    { key: 'country', label: 'Country', placeholder: 'us' },
  ],
  play_store: [{ key: 'appId', label: 'App ID', placeholder: 'com.example.app' }],
  google_reviews: [{ key: 'placeId', label: 'Place ID', placeholder: 'ChIJ...' }],
};
const SOURCE_TYPES = Object.keys(SOURCE_FIELDS);

export function BrandManager() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<Brand[]>('/brands')
      .then((rows) => {
        setBrands(rows);
        setBrandId((prev) => prev || rows[0]?.id || '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load brands'));
  }, []);

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <h2 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 18, margin: '0 0 4px' }}>
        Manage brand
      </h2>
      <p style={{ color: '#8a8f99', fontSize: 13, margin: '0 0 16px' }}>
        Configure data sources and name aliases for a brand.
      </p>

      {error && <p style={{ color: '#e2725b', fontSize: 13 }}>{error}</p>}

      {brands.length === 0 ? (
        <p style={{ color: '#8a8f99', fontSize: 13 }}>No brands yet — create a tenant first.</p>
      ) : (
        <>
          <label style={lbl} htmlFor="brandSelect">
            Brand
          </label>
          <select
            id="brandSelect"
            style={inp}
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.isOwned ? '(owned)' : ''}
              </option>
            ))}
          </select>

          {brandId && (
            <div style={{ display: 'grid', gap: 20, marginTop: 20 }}>
              <SourcesPanel brandId={brandId} />
              <AliasesPanel brandId={brandId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SourcesPanel({ brandId }: { brandId: string }) {
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [source, setSource] = useState(SOURCE_TYPES[0]!);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<Envelope<SourceConfig[]>>(`/brands/${brandId}/integrations`)
      .then((r) => setSources(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load sources'));
  }, [brandId]);

  useEffect(() => {
    setError('');
    load();
  }, [load]);

  async function addSource(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiFetch(`/brands/${brandId}/integrations`, {
        method: 'POST',
        body: JSON.stringify({ source, config: fields, isEnabled: true }),
      });
      setFields({});
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add source');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: SourceConfig) {
    setError('');
    try {
      await apiFetch(`/brands/${brandId}/integrations/${s.source}`, {
        method: 'PATCH',
        body: JSON.stringify({ isEnabled: !s.isEnabled }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update source');
    }
  }

  return (
    <section>
      <h3 style={h3}>Sources</h3>
      {sources.length === 0 ? (
        <p style={muted}>No sources configured.</p>
      ) : (
        <ul style={list}>
          {sources.map((s) => (
            <li key={s.id} style={row}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>{s.source}</span>
              <span style={{ ...muted, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {Object.values(s.config).join(' · ')}
              </span>
              <button
                style={pill(s.isEnabled)}
                onClick={() => toggle(s)}
                aria-label={`${s.isEnabled ? 'Disable' : 'Enable'} ${s.source}`}
              >
                {s.isEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addSource} style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={lbl} htmlFor="sourceType">
              Add source
            </label>
            <select
              id="sourceType"
              style={{ ...inp, width: 150 }}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setFields({});
              }}
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {SOURCE_FIELDS[source]!.map((f) => (
            <div key={f.key}>
              <label style={lbl} htmlFor={`f-${f.key}`}>
                {f.label}
              </label>
              <input
                id={`f-${f.key}`}
                style={{ ...inp, width: 170 }}
                value={fields[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                required
              />
            </div>
          ))}
          <button type="submit" disabled={busy} style={btn}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
      {error && <p style={{ color: '#e2725b', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}
    </section>
  );
}

function AliasesPanel({ brandId }: { brandId: string }) {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<Envelope<Alias[]>>(`/brands/${brandId}/aliases`)
      .then((r) => setAliases(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load aliases'));
  }, [brandId]);

  useEffect(() => {
    setError('');
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiFetch(`/brands/${brandId}/aliases`, {
        method: 'POST',
        body: JSON.stringify({ alias: value.trim() }),
      });
      setValue('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add alias');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await apiFetch(`/brands/${brandId}/aliases/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove alias');
    }
  }

  return (
    <section>
      <h3 style={h3}>Name aliases</h3>
      <p style={muted}>Alternative names / abbreviations used to match this brand in signals.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
        {aliases.length === 0 && <span style={muted}>No aliases yet.</span>}
        {aliases.map((a) => (
          <span key={a.id} style={chip}>
            {a.alias}
            <button
              onClick={() => remove(a.id)}
              aria-label={`Remove alias ${a.alias}`}
              style={chipX}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div>
          <label style={lbl} htmlFor="aliasInput">
            Add alias
          </label>
          <input
            id="aliasInput"
            style={{ ...inp, width: 200 }}
            value={value}
            placeholder="e.g. CDN"
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={busy} style={btn}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>
      {error && <p style={{ color: '#e2725b', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}
    </section>
  );
}

const card: CSSProperties = {
  padding: 24,
  background: '#101217',
  border: '1px solid #1e2128',
  borderRadius: 14,
};
const h3: CSSProperties = { fontSize: 14, margin: '0 0 6px', color: '#e8e8ea' };
const muted: CSSProperties = { color: '#8a8f99', fontSize: 13, margin: 0 };
const lbl: CSSProperties = { display: 'block', fontSize: 12, color: '#8a8f99', margin: '0 0 4px' };
const inp: CSSProperties = {
  padding: '9px 12px',
  background: '#0b0c0f',
  border: '1px solid #1e2128',
  borderRadius: 8,
  color: '#e8e8ea',
  fontSize: 14,
  boxSizing: 'border-box',
};
const btn: CSSProperties = {
  padding: '9px 16px',
  background: '#5dcaa5',
  color: '#06241b',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 };
const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  background: '#0b0c0f',
  border: '1px solid #1e2128',
  borderRadius: 8,
};
const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px 4px 10px',
  background: '#0b0c0f',
  border: '1px solid #1e2128',
  borderRadius: 999,
  fontSize: 13,
};
const chipX: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#8a8f99',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: '0 2px',
};
const pill = (on: boolean): CSSProperties => ({
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: `1px solid ${on ? '#2c5e4f' : '#1e2128'}`,
  background: on ? 'rgba(93,202,165,0.12)' : '#0b0c0f',
  color: on ? '#5dcaa5' : '#8a8f99',
});
