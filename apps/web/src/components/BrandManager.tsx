'use client';

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { sourceMeta } from '@/config/sources';
import { SourceGlyph } from './primitives';

type Brand = { id: string; name: string; slug: string; isOwned: boolean };
type SourceConfig = {
  id: string;
  source: string;
  label: string | null;
  isEnabled: boolean;
  config: Record<string, string>;
  lastFetchedAt: string | null;
};
type Alias = { id: string; alias: string };
type Envelope<T> = { status: string; data: T };

/**
 * Config fields each source type needs. Drives both the add form and the inline editor.
 *
 * `required` matters: a feed missing a required field is stored happily and then throws inside
 * a collection run, where the dispatcher records "source failed" and nobody is told why.
 */
interface SourceField {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  hint?: string;
}

const SOURCE_FIELDS: Record<string, SourceField[]> = {
  rss: [
    {
      key: 'feedUrl',
      label: 'Feed URL',
      placeholder: 'https://news.google.com/rss/search?q=%22Tes+Global%22',
      required: true,
      hint: 'Any RSS or Atom feed. A Google News search URL is the usual way to track a brand name.',
    },
  ],
  youtube: [{ key: 'channelId', label: 'Channel ID', placeholder: 'UCxxxxxxxxxxxx', required: true }],
  app_store: [
    { key: 'appId', label: 'App ID', placeholder: '284882215', required: true },
    { key: 'country', label: 'Country', placeholder: 'gb' },
  ],
  play_store: [{ key: 'appId', label: 'App ID', placeholder: 'com.example.app', required: true }],
  google_reviews: [{ key: 'placeId', label: 'Place ID', placeholder: 'ChIJ...', required: true }],
  reddit: [
    {
      key: 'query',
      label: 'Search term',
      placeholder: '"Tes MyConcern"',
      required: true,
      hint: 'Quote a phrase to match it exactly, exactly as you would in Reddit search.',
    },
    {
      key: 'subreddit',
      label: 'Subreddit',
      placeholder: 'TeachingUK',
      hint: 'Optional. Leave empty to search the whole of Reddit.',
    },
  ],
};
const SOURCE_TYPES = Object.keys(SOURCE_FIELDS);

/** A one-line summary of a feed's config, for when nobody has given it a label. */
function describeConfig(cfg: Record<string, string>): string {
  const values = Object.values(cfg).filter(Boolean);
  return values.length > 0 ? values.join(' · ') : 'no settings';
}

/** Every required field present? */
function isComplete(source: string, fields: Record<string, string>): boolean {
  return (SOURCE_FIELDS[source] ?? []).every((f) => !f.required || (fields[f.key] ?? '').trim());
}

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
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, margin: '0 0 4px' }}>
        Manage brand
      </h2>
      <p style={{ color: 'var(--t2)', fontSize: 13, margin: '0 0 16px' }}>
        Configure data sources and name aliases for a brand.
      </p>

      {error && <p style={{ color: 'var(--coral)', fontSize: 13 }}>{error}</p>}

      {brands.length === 0 ? (
        <p style={{ color: 'var(--t2)', fontSize: 13 }}>No brands yet — create a tenant first.</p>
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

/**
 * The feeds configured for one brand.
 *
 * MANY PER TYPE. This panel used to render one row per source type, because the API allowed one
 * row per source type — and adding a second RSS feed silently replaced the first. A brand
 * tracking both "Tes Global" and "Tes MyConcern" on Google News could hold only one of them, and
 * nothing on screen said which had been lost.
 *
 * Feeds are grouped under their type so a dozen of them stay readable, and each carries a label,
 * because "rss" identifies nothing once there are six.
 */
function SourcesPanel({ brandId }: { brandId: string }) {
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [source, setSource] = useState(SOURCE_TYPES[0]!);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /* One open editor, one armed delete. Two half-edited rows is a way to lose work on the one you
     stopped looking at. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ label: string; fields: Record<string, string> }>({
    label: '',
    fields: {},
  });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
        body: JSON.stringify({ source, config: fields, label: label.trim(), isEnabled: true }),
      });
      setFields({});
      setLabel('');
      load();
    } catch (e) {
      /* Shown verbatim. The API 409 says "this exact feed is already configured", which is the
         difference between a bug and a double-click. */
      setError(e instanceof Error ? e.message : 'Failed to add source');
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError('');
    try {
      await apiFetch(`/brands/${brandId}/integrations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update source');
    }
  }

  async function save(cfg: SourceConfig) {
    if (!isComplete(cfg.source, draft.fields)) {
      setError('Fill in every required field before saving.');
      return;
    }
    setBusy(true);
    await patch(cfg.id, { label: draft.label.trim(), config: draft.fields });
    setEditingId(null);
    setBusy(false);
  }

  async function remove(id: string) {
    setError('');
    setBusy(true);
    try {
      await apiFetch(`/brands/${brandId}/integrations/${id}`, { method: 'DELETE' });
      setConfirmingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove source');
      setConfirmingId(null);
    } finally {
      setBusy(false);
    }
  }

  /* Grouped by type, in the presentation order of SOURCE_TYPES rather than whatever order the API
     returned, so the list does not reshuffle every time a feed is added. */
  const grouped = SOURCE_TYPES.map((type) => ({
    type,
    feeds: sources.filter((s) => s.source === type),
  })).filter((g) => g.feeds.length > 0);

  /* A source type the API knows and this build does not still has to be visible and removable,
     rather than silently dropped from a list the user believes is complete. */
  const unknown = sources.filter((s) => !SOURCE_TYPES.includes(s.source));
  const groups = unknown.length > 0 ? [...grouped, { type: 'other', feeds: unknown }] : grouped;

  return (
    /* `minWidth: 0` on the section, and on every flex item below that holds text.
       A flex item defaults to `min-width: auto`, which means it REFUSES to shrink below its own
       content — so one un-truncated Google News URL in a row made the row 939px wide, and the
       section, the card and the whole column with it, inside a 720px card. Nothing clipped it;
       it simply bled over the edge. This is the fix, and it has to be applied at every level
       between the text and the card, because a single `auto` anywhere in the chain restores the
       overflow. */
    <section style={{ minWidth: 0 }}>
      <h3 style={h3}>Feeds</h3>
      <p style={muted}>
        Add as many as you need of any type — a separate Google News search per product, several
        subreddits, one App Store listing per territory. Every enabled feed runs on each scan.
      </p>

      {sources.length === 0 ? (
        <p style={{ ...muted, marginTop: 12 }}>No feeds configured.</p>
      ) : (
        <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
          {groups.map(({ type, feeds }) => (
            <div key={type}>
              <div style={groupHead}>
                <SourceGlyph name={type} />
                <span>{sourceMeta(type).label}</span>
                <span style={{ color: 'var(--t3)', fontWeight: 400 }}>
                  {feeds.length === 1 ? '1 feed' : `${feeds.length} feeds`}
                </span>
              </div>

              <ul style={list}>
                {feeds.map((s) =>
                  editingId === s.id ? (
                    <li key={s.id} style={{ ...row, display: 'block' }}>
                      <div
                        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
                      >
                        <div>
                          <label style={lbl} htmlFor={`edit-label-${s.id}`}>
                            Name
                          </label>
                          <input
                            id={`edit-label-${s.id}`}
                            style={{ ...inp, ...field(190) }}
                            value={draft.label}
                            placeholder="e.g. Google News — MyConcern"
                            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                          />
                        </div>
                        {(SOURCE_FIELDS[s.source] ?? []).map((f) => (
                          <div key={f.key} style={fieldBox(230)}>
                            <label style={lbl} htmlFor={`edit-${s.id}-${f.key}`}>
                              {f.label}
                              {f.required ? '' : ' (optional)'}
                            </label>
                            <input
                              id={`edit-${s.id}-${f.key}`}
                              style={{ ...inp, ...field(230) }}
                              value={draft.fields[f.key] ?? ''}
                              placeholder={f.placeholder}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  fields: { ...d.fields, [f.key]: e.target.value },
                                }))
                              }
                            />
                          </div>
                        ))}
                        <button
                          type="button"
                          style={btn}
                          disabled={busy}
                          onClick={() => void save(s)}
                        >
                          Save
                        </button>
                        <button type="button" style={btnGhost} onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li key={s.id} style={row}>
                      {/* Name over settings, in ONE flexible column, rather than side by side.
                          Two competing text elements on a row that also carries a status, a
                          toggle and two buttons cannot both be readable at 672px — and a feed
                          identified by a 90-character Google News URL needs the whole width it
                          can get. Stacked, each truncates independently and the full value is on
                          the title attribute. */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={ellipsis} title={s.label ?? describeConfig(s.config)}>
                          {s.label || describeConfig(s.config)}
                        </div>
                        {s.label && (
                          <div
                            style={{ ...ellipsis, ...muted, fontSize: 11.5, fontWeight: 400 }}
                            title={describeConfig(s.config)}
                          >
                            {describeConfig(s.config)}
                          </div>
                        )}
                      </div>

                      <span style={{ ...muted, fontSize: 11, whiteSpace: 'nowrap', flex: 'none' }}>
                        {s.lastFetchedAt
                          ? `last run ${new Date(s.lastFetchedAt).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                            })}`
                          : 'never run'}
                      </span>

                      <button
                        style={pill(s.isEnabled)}
                        onClick={() => void patch(s.id, { isEnabled: !s.isEnabled })}
                        aria-label={`${s.isEnabled ? 'Disable' : 'Enable'} ${s.label || describeConfig(s.config)}`}
                      >
                        {s.isEnabled ? 'Enabled' : 'Disabled'}
                      </button>

                      <button
                        style={btnGhost}
                        aria-label={`Edit ${s.label || describeConfig(s.config)}`}
                        onClick={() => {
                          setConfirmingId(null);
                          setEditingId(s.id);
                          setDraft({ label: s.label ?? '', fields: { ...s.config } });
                        }}
                      >
                        Edit
                      </button>

                      {confirmingId === s.id ? (
                        <>
                          <button
                            style={btnDanger}
                            disabled={busy}
                            onClick={() => void remove(s.id)}
                          >
                            Confirm remove
                          </button>
                          <button style={btnGhost} onClick={() => setConfirmingId(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button
                          style={btnGhost}
                          aria-label={`Remove ${s.label || describeConfig(s.config)}`}
                          onClick={() => setConfirmingId(s.id)}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={addSource} style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={lbl} htmlFor="sourceType">
              Feed type
            </label>
            <select
              id="sourceType"
              style={{ ...inp, ...field(150) }}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setFields({});
              }}
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {sourceMeta(t).label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="sourceLabel">
              Name (optional)
            </label>
            <input
              id="sourceLabel"
              style={{ ...inp, ...field(190) }}
              value={label}
              placeholder="e.g. Google News — MyConcern"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          {SOURCE_FIELDS[source]!.map((f) => (
            <div key={f.key} style={fieldBox(230)}>
              <label style={lbl} htmlFor={`f-${f.key}`}>
                {f.label}
                {f.required ? '' : ' (optional)'}
              </label>
              <input
                id={`f-${f.key}`}
                style={{ ...inp, ...field(230) }}
                value={fields[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                required={f.required}
              />
              {f.hint && (
                <p style={{ ...muted, fontSize: 11, margin: '3px 0 0' }}>{f.hint}</p>
              )}
            </div>
          ))}
          {/* "Add feed", not "Add". The aliases panel below has its own submit button, and two
              controls both reading "Add" on one screen is ambiguous to anyone using a screen
              reader or voice control. It was ambiguous to the tests too, which is how it was
              noticed. */}
          <button type="submit" disabled={busy || !isComplete(source, fields)} style={btn}>
            {busy ? 'Adding…' : 'Add feed'}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" style={{ color: 'var(--coral)', fontSize: 13, margin: '8px 0 0' }}>
          {error}
        </p>
      )}
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
            style={{ ...inp, ...field(200) }}
            value={value}
            placeholder="e.g. CDN"
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={busy} style={btn}>
          {busy ? 'Adding…' : 'Add alias'}
        </button>
      </form>
      {error && <p style={{ color: 'var(--coral)', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}
    </section>
  );
}

const card: CSSProperties = {
  padding: 24,
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  /* The backstop. Every other card on this page is exactly 720px; this one grew to fit its
     widest child and bled 245px past the column. If some future child still refuses to shrink,
     it is clipped here rather than dragging the page out of alignment. */
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
};
const h3: CSSProperties = { fontSize: 14, margin: '0 0 6px', color: 'var(--t1)' };
const muted: CSSProperties = { color: 'var(--t2)', fontSize: 13, margin: 0 };
const lbl: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--t2)',
  margin: '0 0 4px',
};
/**
 * A form field that keeps its preferred width but is allowed to shrink.
 *
 * These were fixed pixel widths — 150 + 190 + 230 + a button, inside a 672px column. In a
 * wrapping row that does not overflow, but it does force an awkward break and, before the row
 * wrapped at all, it was part of what pushed the card open. `flex` lets each field claim its
 * preferred size and give it back when there is not enough room.
 */
function field(preferred: number): CSSProperties {
  return { flex: `1 1 ${preferred}px`, minWidth: 0, width: 'auto', maxWidth: '100%' };
}

/** The label + input wrapper around one field. It has to shrink with the field inside it. */
function fieldBox(preferred: number): CSSProperties {
  return { flex: `1 1 ${preferred}px`, minWidth: 0, maxWidth: '100%' };
}

const inp: CSSProperties = {
  padding: '9px 12px',
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  color: 'var(--t1)',
  fontSize: 14,
  boxSizing: 'border-box',
};
const btn: CSSProperties = {
  padding: '9px 16px',
  /* The user's chosen highlight, not the status ramp. `--mint` is the legacy "positive"
     colour and painted these actions olive regardless of the accent selected. */
  background: 'var(--accent)',
  color: 'var(--accent-on)',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
/** Header of one source-type group — glyph, name, and how many feeds are under it. */
const groupHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12.5,
  fontWeight: 600,
  color: 'var(--t2)',
  margin: '0 0 6px',
};
/* Secondary actions on a crowded row. Bordered rather than bare, because the panel already
   learned this lesson once: an unlabelled ghost control between other elements reads as
   decoration and is not found at all. */
const btnGhost: CSSProperties = {
  padding: '6px 11px',
  background: 'transparent',
  border: '1px solid var(--line)',
  borderRadius: 8,
  color: 'var(--t2)',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
/** Destructive confirmation. `--coral` is the status ramp, which is exactly right here. */
const btnDanger: CSSProperties = {
  ...btnGhost,
  color: 'var(--coral)',
  borderColor: 'color-mix(in srgb, var(--coral) 45%, transparent)',
};
/** One line of text that truncates rather than widening its parent. */
const ellipsis: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  fontWeight: 600,
};
const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 };
const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  /* Both are load-bearing. `minWidth: 0` lets the row shrink to its container instead of to its
     content; `flexWrap` is the safety valve for a genuinely narrow viewport, where the controls
     drop to a second line rather than pushing the card open. */
  minWidth: 0,
  flexWrap: 'wrap',
};
const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px 4px 10px',
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 999,
  fontSize: 13,
};
const chipX: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--t2)',
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
  border: `1px solid ${on ? 'color-mix(in srgb, var(--mint) 40%, transparent)' : 'var(--line)'}`,
  background: on ? 'rgba(93,202,165,0.12)' : 'var(--bg)',
  color: on ? 'var(--mint)' : 'var(--t2)',
});
